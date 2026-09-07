"""Exercise version arguments without Docker, network, or Feishu writes."""
import os
from pathlib import Path
import subprocess
import tempfile

script = Path(__file__).with_name('build_image.sh').resolve()
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    log = root / 'calls'
    for name, body in {
        'uname': 'echo x86_64',
        'docker': 'printf "%s\\n" "$*" >> "$BUILD_VERSION_TEST_LOG"',
        'python3': 'exit 0',
    }.items():
        tool = root / name
        tool.write_text('#!/bin/sh\n' + body + '\n')
        tool.chmod(0o755)
    env = dict(os.environ, PATH=f'{root}:{os.environ["PATH"]}', BUILD_VERSION_TEST_LOG=str(log))
    for arguments in [[], ['--app-version', 'invalid']]:
        result = subprocess.run(['bash', str(script), '--sheet', 'AMD_with_cuda', *arguments], env=env, capture_output=True)
        assert result.returncode != 0
        assert not log.exists(), 'invalid version must fail before any build or push'
    subprocess.run(['bash', str(script), '--app-version', '0.0.15', '--sheet', 'AMD_with_cuda'], env=env, check=True, capture_output=True)
    builds = [line for line in log.read_text().splitlines() if line.startswith('buildx build ')]
    assert len(builds) == 2
    assert all('--build-arg VOS_APP_VERSION=0.0.15' in line and '_v0.0.15' in line for line in builds)
print('Target version reaches both builds and image tags; missing/invalid version rejected')
