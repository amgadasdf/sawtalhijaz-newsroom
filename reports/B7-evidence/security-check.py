"""B7 local heuristic secret scan; prints paths/counts only, never secret values."""
import json, pathlib, re, subprocess
root = pathlib.Path('.')
files = [p for p in root.rglob('*') if p.is_file() and '.git' not in p.parts and 'node_modules' not in p.parts]
patterns = [rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----', rb'AKIA[0-9A-Z]{16}', rb'gh[pousr]_[A-Za-z0-9]{30,}', rb'github_pat_[A-Za-z0-9_]{40,}', rb'sk-[A-Za-z0-9]{32,}', rb'(?i)(?:api[_-]?key|client[_-]?secret|password|access[_-]?token)\s*[=:]\s*["\x27][A-Za-z0-9_+/=-]{16,}["\x27]']
hits = []
for p in files:
    if any(re.search(rx,p.read_bytes()) for rx in patterns): hits.append(str(p))
print(f'workspace_files_scanned={len(files)} | secret_pattern_hits={len(hits)}')
for p in hits: print('REVIEW_PATH='+p)
tracked = subprocess.check_output(['git','ls-files','-z']).decode().split('\0')
sensitive = [p for p in tracked if p and (pathlib.Path(p).name.startswith('.env') or pathlib.Path(p).suffix in ('.pem','.key','.p12','.pfx') or pathlib.Path(p).name in ('id_rsa','id_ed25519','.netrc','.git-credentials'))]
print(f'tracked_sensitive_filenames={len(sensitive)}')
print(subprocess.check_output(['git','check-ignore','-v','--no-index','.env','.env.production','node_modules/b7-probe','B7.patch','state/runs/_selftest/b7-probe']).decode(),end='')
pkg=json.loads(pathlib.Path('package.json').read_text())
print('dependencies='+json.dumps(pkg.get('dependencies',{})))
print('devDependencies='+json.dumps(pkg.get('devDependencies',{})))
html=pathlib.Path('out/radar-2026-09-27T12-00-00-000Z.html').read_text()
active=re.findall(r'<(?:script|a|link|img|iframe|form|object|embed|audio|video)\b|\b(?:src|href)\s*=|url\s*\(|@import|@font-face', html,re.I)
print(f'existing_local_dashboard_active_references={len(active)}')
assert not hits and not sensitive and not pkg.get('dependencies') and not pkg.get('devDependencies') and not active
print('security_static_gate=PASS (heuristic scan, not a mathematical absence proof)')
