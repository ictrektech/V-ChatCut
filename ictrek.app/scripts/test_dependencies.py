import io
import json
import os
import unittest
from unittest.mock import patch

from resolve_dependencies import appstore_version, resolve_dependencies


class DependencyTests(unittest.TestCase):
    def test_latest_release_is_written_into_requirement(self):
        manifest = {'dependencies': {'apps': [{'id': 'com.ictrek.v-scheduler', 'version': 'latest'}]}}
        release = {'tag_name': 'v0.0.24', 'published_at': '2026-10-16', 'assets': [{'name': 'v_scheduler_0.0.24_pull.tar'}]}
        with patch.dict(os.environ, {'VOS_DEPENDENCY_CATALOG_URL': ''}), patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(release).encode())):
            resolve_dependencies(manifest, {'com.ictrek.v-scheduler': 'ictrektech/V-Scheduler'})
        self.assertEqual(manifest['dependencies']['apps'][0]['version'], '>=0.0.24')

    def test_release_without_package_is_rejected(self):
        manifest = {'dependencies': {'apps': [{'id': 'com.ictrek.v-scheduler'}]}}
        release = {'tag_name': 'v0.0.24', 'published_at': '2026-10-16', 'assets': []}
        with patch.dict(os.environ, {'VOS_DEPENDENCY_CATALOG_URL': ''}), patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(release).encode())), self.assertRaisesRegex(ValueError, 'no VOS pull package'):
            resolve_dependencies(manifest, {'com.ictrek.v-scheduler': 'ictrektech/V-Scheduler'})

    def test_store_requires_latest_record_and_real_archive(self):
        app = 'com.ictrek.v-scheduler'
        record = {'code': 0, 'data': {'id': app, 'current_version': '0.0.24', 'versions': ['0.0.23', '0.0.24'], 'app_tar_gz': {'size': 1280, 'download_path': f'appstore/apps/{app}/0.0.24/app.tar.gz'}}}
        archive = io.BytesIO(b'\x1f\x8b')
        archive.status = 206
        archive.headers = {'Content-Range': 'bytes 0-1/1280'}
        with patch('urllib.request.urlopen', side_effect=[io.BytesIO(json.dumps(record).encode()), archive]):
            self.assertEqual(appstore_version(app, 'http://127.0.0.1:18899'), '0.0.24')
        record['data']['versions'].append('0.0.25')
        with patch('urllib.request.urlopen', return_value=io.BytesIO(json.dumps(record).encode())), self.assertRaisesRegex(RuntimeError, 'no verified latest'):
            appstore_version(app, 'http://127.0.0.1:18899')

    def test_unapproved_catalog_is_rejected(self):
        with self.assertRaisesRegex(RuntimeError, 'loopback'):
            appstore_version('com.ictrek.v-scheduler', 'https://unapproved.example')


if __name__ == '__main__':
    unittest.main()
