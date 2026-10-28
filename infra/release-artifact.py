#!/usr/bin/env python3
"""Artefactos estáticos con inventario, commit y checksum del grafo."""
import hashlib
import io
import json
import pathlib
import re
import sys
import tarfile

if not __debug__:
    raise RuntimeError('La verificación de artefactos requiere Python sin -O')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def pack(commit, dist, graph, archive):
    assert re.fullmatch(r'[0-9a-f]{40}', commit), 'Commit inválido'
    files = {}
    for path in dist.rglob('*'):
        assert not path.is_symlink(), 'No se admiten enlaces'
        if path.is_file():
            files[path.relative_to(dist).as_posix()] = path.read_bytes()
    data = graph.read_bytes()
    assert files.get('data/grafo_manta.json') == data and files.get('index.html'), 'Build o grafo incompatible'
    manifest = {'schemaVersion': 1, 'commit': commit, 'graphSha256': sha(data),
                'graphVersion': json.loads(data)['metadata']['graphVersion'],
                'files': {name: sha(data) for name, data in sorted(files.items())}}
    with tarfile.open(archive, 'w:gz') as stream:
        for name, data in {'release-manifest.json': json.dumps(manifest).encode(),
                           **{'dist/' + name: data for name, data in files.items()}}.items():
            item = tarfile.TarInfo(name)
            item.size, item.mode = len(data), 0o644
            stream.addfile(item, io.BytesIO(data))
    return manifest


def verify(commit, archive, graph, output):
    assert re.fullmatch(r'[0-9a-f]{40}', commit), 'Commit inválido'
    files, size = {}, 0
    with tarfile.open(archive, 'r:gz') as stream:
        for item in stream:
            name = pathlib.PurePosixPath(item.name)
            assert not name.is_absolute() and '..' not in name.parts and str(name) == item.name, 'Ruta inválida'
            if item.isdir():
                continue
            assert item.isfile() and item.name not in files, 'Entrada inválida o duplicada'
            size += item.size
            assert size <= 512 * 1024 * 1024 and len(files) < 10000, 'Artefacto demasiado grande'
            files[item.name] = stream.extractfile(item).read()
    manifest = json.loads(files.pop('release-manifest.json'))
    assert manifest['schemaVersion'] == 1 and manifest['commit'] == commit, 'Otro commit'
    data = graph.read_bytes()
    assert manifest['graphSha256'] == sha(data), 'Grafo incompatible'
    assert manifest['graphVersion'] == json.loads(data)['metadata']['graphVersion'], 'graphVersion incompatible'
    assert set(files) == {'dist/' + name for name in manifest['files']}, 'Inventario incompatible'
    for name, digest in manifest['files'].items():
        assert sha(files['dist/' + name]) == digest, 'Checksum inválido: ' + name
    assert files['dist/data/grafo_manta.json'] == data and files['dist/index.html'], 'Build incompatible'
    output.mkdir(parents=True, exist_ok=False)
    for name, data in {**files, 'release-manifest.json': json.dumps(manifest, indent=2).encode()}.items():
        dest = output / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
    return manifest


if __name__ == '__main__':
    mode, commit, source, graph, dest = sys.argv[1:]
    manifest = {'pack': pack, 'verify': verify}[mode](commit, pathlib.Path(source), pathlib.Path(graph), pathlib.Path(dest))
    print(json.dumps({'commit': manifest['commit'], 'files': len(manifest['files']), 'graphSha256': manifest['graphSha256']}))
