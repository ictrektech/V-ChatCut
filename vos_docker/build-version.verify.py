"""Verify platform-and-date image tags without Docker, network, or Feishu writes."""
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
    subprocess.run(['bash', str(script), '--sheet', 'AMD_with_cuda'], env=env, check=True, capture_output=True)
    builds = [line for line in log.read_text().splitlines() if line.startswith('buildx build ')]
    assert len(builds) == 2
    assert all('_v0.0.' not in line for line in builds)
    assert all('VOS_APP_VERSION' not in line for line in builds)
    assert any('v-chatcut-frontend:amd_' in line for line in builds)
    assert any('v-chatcut-backend:amd_cu128_' in line for line in builds)
print('Image tags contain platform and date only')
