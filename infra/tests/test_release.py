import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest

INFRA = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('artifact', INFRA / 'release-artifact.py')
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)
COMMIT = 'a' * 40


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.graph = self.root / 'graph.json'
        self.graph.write_text(json.dumps({'metadata': {'graphVersion': 'fixture'}}))
        self.dist = self.root / 'dist'
        (self.dist / 'data').mkdir(parents=True)
        (self.dist / 'data/grafo_manta.json').write_bytes(self.graph.read_bytes())
        (self.dist / 'index.html').write_text('<div id="root">fixture</div>')
        self.archive = self.root / 'frontend.tgz'
        artifact.pack(COMMIT, self.dist, self.graph, self.archive)

    def test_artifact_roundtrip_and_wrong_commit(self):
        artifact.verify(COMMIT, self.archive, self.graph, self.root / 'verified')
        with self.assertRaises(AssertionError):
            artifact.verify('b' * 40, self.archive, self.graph, self.root / 'wrong')
        self.assertFalse((self.root / 'wrong').exists())

    def test_corruption_and_graph_mismatch_before_extraction(self):
        with tarfile.open(self.archive, 'r:gz') as stream:
            members = {m.name: stream.extractfile(m).read() for m in stream}
        members['dist/index.html'] = b'corrupted'
        with tarfile.open(self.archive, 'w:gz') as stream:
            for name, data in members.items():
                item = tarfile.TarInfo(name); item.size = len(data)
                stream.addfile(item, io.BytesIO(data))
        with self.assertRaises(AssertionError):
            artifact.verify(COMMIT, self.archive, self.graph, self.root / 'corrupt')
        self.assertFalse((self.root / 'corrupt').exists())
        artifact.pack(COMMIT, self.dist, self.graph, self.archive)
        self.graph.write_text('{"metadata":{"graphVersion":"different"}}')
        with self.assertRaises(AssertionError):
            artifact.verify(COMMIT, self.archive, self.graph, self.root / 'different')

    def test_archive_rejects_traversal_and_links(self):
        for name, kind in [('../escaped', tarfile.REGTYPE), ('dist/link', tarfile.SYMTYPE)]:
            with self.subTest(name=name):
                with tarfile.open(self.archive, 'w:gz') as stream:
                    item = tarfile.TarInfo(name); item.type = kind
                    stream.addfile(item)
                with self.assertRaises(AssertionError):
                    artifact.verify(COMMIT, self.archive, self.graph, self.root / 'invalid')
        self.assertFalse((self.root.parent / 'escaped').exists())

    def fixture(self):
        self.app = self.root / 'app'
        self.repo = self.root / 'repo'
        (self.repo / 'backend/data').mkdir(parents=True)
        (self.repo / 'backend/data/grafo_manta.json').write_bytes(self.graph.read_bytes())
        shutil.copytree(INFRA, self.repo / 'infra')
        for base in [self.app / 'releases/old', self.app / 'web/releases/old']:
            base.mkdir(parents=True)
            (base / 'COMMIT').write_text('0' * 40)
        old = self.app / 'releases/old'
        (old / 'backend/data').mkdir(parents=True)
        (old / 'backend/data/grafo_manta.json').write_bytes(self.graph.read_bytes())
        (old / 'infra').mkdir()
        (old / 'infra/ecosystem.config.cjs').write_text('fixture')
        (self.app / 'web/releases/old/data').mkdir()
        (self.app / 'web/releases/old/data/grafo_manta.json').write_bytes(self.graph.read_bytes())
        (self.app / 'web/releases/old/index.html').write_text('<div id="root">old</div>')
        (self.app / 'current').symlink_to(old)
        (self.app / 'web/current').symlink_to('releases/old')
        self.config = self.root / 'Caddyfile'
        self.config.write_text('old-config')
        env_file = self.root / 'backend.env'; env_file.write_text('fixture')
        bin_dir = self.root / 'bin'; bin_dir.mkdir()
        commands = {
            'node': 'exit 0',
            'npm': 'echo "npm $*" >> "$FIX_LOG"; test "${FAIL_PREP:-}" != 1',
            'sleep': 'exit 0',
            'sudo': 'exec "$@"',
            'git': '''if [[ " $* " == *" rev-parse "* ]]; then printf '%s\\n' "$FIX_COMMIT"; else tar -cf - -C "$FIX_REPO" .; fi''',
            'pm2': '''echo "pm2 $*" >> "$FIX_LOG"
case "$1" in
 jlist) echo '[]';;
 stop|delete) echo 0 > "$FIX_ACTIVE";;
 start)
  [[ "$(cat "$FIX_ACTIVE" 2>/dev/null || echo 0)" == 0 ]] || exit 3
  echo 1 > "$FIX_ACTIVE"
  if [[ "${FAIL_READY:-}" == 1 && ! -f "$FIX_TRIPPED" ]]; then touch "$FIX_TRIPPED"; echo 1 > "$FIX_BAD_READY"; else echo 0 > "$FIX_BAD_READY"; fi;;
esac''',
            'docker': '''echo "docker $*" >> "$FIX_LOG"
if [[ "$1" == inspect ]]; then printf '[{"Destination":"/srv/spookython","RW":false,"Source":"%s/web"}]\\n' "$APP_ROOT"; fi
if [[ " $* " == *" validate "* && "${FAIL_CADDY:-}" == 1 ]]; then exit 1; fi
if [[ " $* " == *" reload "* && "${FAIL_RELOAD:-}" == 1 && ! -f "$FIX_TRIPPED" ]]; then touch "$FIX_TRIPPED"; exit 1; fi''',
            'curl': '''out=''; url=''
while (( $# )); do case "$1" in -o) out=$2; shift 2;; http*) url=$1; shift;; *) shift;; esac; done
if [[ "$url" == */health/ready ]]; then [[ "$(cat "$FIX_BAD_READY" 2>/dev/null || echo 0)" == 0 ]]; exit $?; fi
if [[ "$url" == */data/grafo_manta.json ]]; then cp "$APP_ROOT/current/backend/data/grafo_manta.json" "$out"; else cp "$APP_ROOT/web/current/index.html" "$out"; fi''',
        }
        for name, body in commands.items():
            file = bin_dir / name
            file.write_text('#!/usr/bin/env bash\nset -e\n' + body + '\n'); file.chmod(0o755)
        self.env = {**os.environ, 'PATH': str(bin_dir) + ':' + os.environ['PATH'],
                    'APP_ROOT': str(self.app), 'CADDY_CONFIG': str(self.config),
                    'REPO_DIR': str(self.repo), 'BACKEND_ENV_FILE': str(env_file),
                    'FIX_LOG': str(self.root / 'commands.log'), 'FIX_REPO': str(self.repo),
                    'FIX_COMMIT': COMMIT, 'FIX_ACTIVE': str(self.root / 'active'),
                    'FIX_TRIPPED': str(self.root / 'tripped'), 'FIX_BAD_READY': str(self.root / 'bad-ready')}

    def deploy(self, **extra):
        return subprocess.run(['bash', str(INFRA / 'deploy-ec2.sh'), COMMIT, str(self.archive),
                               artifact.sha(self.archive.read_bytes())], env={**self.env, **extra},
                              text=True, capture_output=True, timeout=30)

    def assert_old(self):
        self.assertEqual((self.app / 'current').resolve(), self.app / 'releases/old')
        self.assertEqual((self.app / 'web/current').resolve(), self.app / 'web/releases/old')
        self.assertEqual(self.config.read_text(), 'old-config')

    def test_prepare_failures_never_stop_current_writer(self):
        for failure in ['FAIL_PREP', 'FAIL_CADDY']:
            with self.subTest(failure=failure):
                if not hasattr(self, 'env'): self.fixture()
                result = self.deploy(**{failure: '1'})
                self.assertNotEqual(result.returncode, 0)
                self.assert_old()
                self.assertNotIn('pm2 stop', Path(self.env['FIX_LOG']).read_text())

    def test_bad_transfer_never_stops_writer(self):
        self.fixture()
        result = subprocess.run(['bash', str(INFRA / 'deploy-ec2.sh'), COMMIT, str(self.archive), '0' * 64],
                                env=self.env, capture_output=True)
        self.assertNotEqual(result.returncode, 0); self.assert_old()
        self.assertFalse(Path(self.env['FIX_LOG']).exists())

    def test_readiness_failure_restores_pair(self):
        self.fixture()
        result = self.deploy(FAIL_READY='1')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_old()
        self.assertIn('Entrega anterior restaurada', result.stderr)

    def test_caddy_reload_failure_restores_pair(self):
        self.fixture()
        result = self.deploy(FAIL_RELOAD='1')
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assert_old()
        self.assertIn('Entrega anterior restaurada', result.stderr)

    def test_repeat_deployment_and_rollback_keep_pair_and_single_writer(self):
        self.fixture()
        result = self.deploy(); self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        first = (self.app / 'current').resolve()
        result = self.deploy(); self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotEqual(first, (self.app / 'current').resolve())
        result = subprocess.run(['bash', str(INFRA / 'rollback-ec2.sh')], env=self.env, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(first, (self.app / 'current').resolve())
        state = json.loads((self.app / 'current-release.json').read_text())
        self.assertEqual(Path(state['frontend']), (self.app / 'web/current').resolve())
        self.assertEqual(state['commit'], COMMIT)

    def test_deployment_lock_prevents_parallel_changes(self):
        import fcntl
        self.fixture()
        with (self.app / 'deploy.lock').open('w') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            result = self.deploy()
        self.assertNotEqual(result.returncode, 0); self.assert_old()
        self.assertFalse(Path(self.env['FIX_LOG']).exists())


if __name__ == '__main__':
    unittest.main()
