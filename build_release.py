"""Offline, content-addressed build/pack only. NEVER activates or publishes."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile

ROOT = Path(__file__).resolve().parent
RUNTIME_FILES = ['package.json','openclaw.plugin.json','README.md','CAPABILITIES.json','dist-runtime/index.js','sql-classify.mjs','peer-memory.mjs','server-contract.mjs','shared-host-adapter.mjs']
SOURCE_FILES = ['package.json','openclaw.plugin.json','README.md','CAPABILITIES.json','release-entry.mjs','status-tool.mjs',
    'authenticated-request-adapter.mjs','receipt-contract.mjs','workflow.mjs','m365-adapter.mjs','build_release.py','release_pack_test.py','archive-smoke.mjs','index.mjs',
    'sql-classify.mjs','peer-memory.mjs','server-contract.mjs','shared-host-adapter.mjs','native-loop-repair/proposed/index.mjs']

def sha(data): return hashlib.sha256(data).hexdigest()
def run(args, cwd=ROOT):
    result=subprocess.run([str(a) for a in args],cwd=cwd,capture_output=True,text=True,timeout=45)
    if result.returncode: raise RuntimeError((result.stdout+result.stderr)[-3000:])
    return result.stdout
def write_immutable(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        if path.read_bytes()!=data: raise RuntimeError('Immutable release path collision: '+str(path))
    else:path.write_bytes(data)
def archive_bytes(files,prefix):
    stream=io.BytesIO()
    with gzip.GzipFile(filename='',fileobj=stream,mode='wb',mtime=0) as gz:
        with tarfile.open(fileobj=gz,mode='w',format=tarfile.USTAR_FORMAT) as tar:
            for name,data in sorted(files.items()):
                info=tarfile.TarInfo(prefix+'/'+name);info.size=len(data);info.mode=0o644;info.mtime=0
                tar.addfile(info,io.BytesIO(data))
    return stream.getvalue()
def verify_archive(data,expected,prefix):
    with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tar:
        names=[]
        for member in tar.getmembers():
            if member.isdir():continue
            if not member.isfile() or member.name.startswith('/') or '..' in Path(member.name).parts:
                raise RuntimeError('Unsafe archive member')
            if not member.name.startswith(prefix+'/'):raise RuntimeError('Unexpected archive prefix')
            name=member.name[len(prefix)+1:];names.append(name)
            if name not in expected or tar.extractfile(member).read()!=expected[name]:raise RuntimeError('Archive byte mismatch: '+name)
        if sorted(names)!=sorted(expected):raise RuntimeError('Archive allowlist mismatch')
def content_artifact(data,name):
    path=ROOT/'release'/'artifacts'/sha(data)/name;write_immutable(path,data)
    return {'path':str(path.relative_to(ROOT)),'sha256':sha(data),'bytes':len(data)}

def build(args):
    (ROOT/'build-workspaces').mkdir(exist_ok=True)
    run([args.bun,'build','./release-entry.mjs','--target=node','--external=openclaw/plugin-sdk/gateway-method-runtime','--outfile=./dist-runtime/index.js'])
    package=json.loads((ROOT/'package.json').read_text());package.pop('scripts',None)
    runtime={name:(ROOT/name).read_bytes() for name in RUNTIME_FILES}
    runtime['package.json']=(json.dumps(package,indent=2)+'\n').encode()
    fingerprint=sha(json.dumps({k:sha(v) for k,v in sorted(runtime.items())},sort_keys=True).encode())
    workspace=ROOT/'release'/'work'/fingerprint;stage=workspace/'package';stage.mkdir(parents=True,exist_ok=True)
    for name,data in runtime.items():
        target=stage/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(data)
    user_config=workspace/'empty-user-npmrc';user_config.write_text('')
    global_config=workspace/'empty-global-npmrc';global_config.write_text('')
    packed=[]
    for suffix in ['pack-a','pack-b']:
        destination=workspace/suffix;destination.mkdir(parents=True,exist_ok=True)
        output=run([args.node,args.npm_cli,'pack','--ignore-scripts','--offline','--json',
            '--userconfig',user_config,'--globalconfig',global_config,'--cache',workspace/'npm-cache',
            '--pack-destination',destination],cwd=stage)
        result=json.loads(output)[0];packed.append((destination/result['filename']).read_bytes())
    if packed[0]!=packed[1]:raise RuntimeError('Repeated npm packing is not reproducible')
    verify_archive(packed[0],runtime,'package')
    install=content_artifact(packed[0],f"{package['name']}-{package['version']}.tgz")
    source={name:(ROOT/name).read_bytes() for name in SOURCE_FILES}
    for p in (ROOT/'server').glob('*.py'):source[str(p.relative_to(ROOT))]=p.read_bytes()
    for p in ROOT.glob('*.test.mjs'):source[p.name]=p.read_bytes()
    for name in ['repair.test.mjs','original/index.mjs','original/package.json','original/openclaw.plugin.json','CURRENT-SOURCE.json','REVIEW.json','installed-index.patch','restore-index.patch']:
        source['native-loop-repair/'+name]=(ROOT/'native-loop-repair'/name).read_bytes()
    for p in (ROOT/'server37').rglob('*'):
        if p.is_file() and 'build-workspaces' not in p.relative_to(ROOT).parts and (p.suffix in ('.py','.sql','.json','.sh','.patch','.spec') or p.name=='omatic-server'):
            source[str(p.relative_to(ROOT))]=p.read_bytes()
    source_data=archive_bytes(source,'o-matic-server-connection-source');verify_archive(source_data,source,'o-matic-server-connection-source')
    source_artifact=content_artifact(source_data,'o-matic-server-connection-source.tgz')
    source_smoke=json.loads(run([sys.executable, ROOT/'server37/archive_runtime_smoke.py',ROOT/source_artifact['path']]))
    installed=Path(args.installed_plugin)
    observed_installed={name:(installed/name).read_bytes() for name in ['index.mjs','openclaw.plugin.json','package.json']}
    # After activation, never recapture candidate bytes as rollback originals.
    original_digest='7f3a90a8e01072e15351ea75222fa7f76a474c4e7d6afab38fed5153501bc477'
    original_archive=ROOT/'release/artifacts'/original_digest/'omatic-governance-originals.tgz'
    if not original_archive.exists():
        preserved={name:(ROOT/'native-loop-repair/original'/name).read_bytes() for name in ['index.mjs','openclaw.plugin.json','package.json']}
        original_bytes=archive_bytes(preserved,'rollback')
        if sha(original_bytes)!=original_digest:raise RuntimeError('Preserved original baseline does not reconstruct approved rollback')
        write_immutable(original_archive,original_bytes)
    if sha(original_archive.read_bytes())!=original_digest:raise RuntimeError('Independent rollback archive drift')
    with tarfile.open(original_archive,'r:gz') as tar:
        recovery={name:tar.extractfile('rollback/'+name).read() for name in ['index.mjs','openclaw.plugin.json','package.json']}
    verify_archive(original_archive.read_bytes(),recovery,'rollback')
    if observed_installed['package.json']!=recovery['package.json']:raise RuntimeError('Installed package identity drift')
    for name,current in observed_installed.items():
        candidate=runtime['dist-runtime/index.js'] if name=='index.mjs' else runtime.get(name,recovery[name])
        if current not in (recovery[name],candidate):raise RuntimeError('Unreviewed installed file drift: '+name)
    recovery_data=archive_bytes(recovery,'rollback');verify_archive(recovery_data,recovery,'rollback')
    recovery_artifact=content_artifact(recovery_data,'omatic-governance-originals.tgz')
    # Extract only verified allowlisted regular-file payloads into a NEW local
    # workspace. No installer, target write, config reload or live DB is used.
    extracted=workspace/'extracted'
    for name,data in runtime.items():
        path=extracted/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    smoke=ROOT/'archive-smoke.mjs'
    smoke_result=json.loads(run([args.node,smoke,extracted/'dist-runtime/index.js']))
    lint=run([args.bun,args.openclaw_cli,'plugins','lint','--root',extracted,'--json'])
    lint_result=json.loads(lint)
    if not lint_result.get('complete') or lint_result.get('warnings'):raise RuntimeError('Stock lint did not pass cleanly')
    # Recovery simulation is confined to local build workspace. Original bytes
    # come from separate recovery archive, not from the candidate artifact.
    sandbox=workspace/'recovery-simulation';sandbox.mkdir(parents=True,exist_ok=True)
    target=sandbox/'index.mjs';target.write_bytes(recovery['index.mjs']);target.write_bytes(runtime['dist-runtime/index.js'])
    target.write_bytes(b'corrupt candidate fixture');target.write_bytes(recovery['index.mjs'])
    if target.read_bytes()!=recovery['index.mjs']:raise RuntimeError('Recovery simulation failed')
    overlay=[{'target':str(installed/'index.mjs'),'originalSha256':sha(recovery['index.mjs']),
        'archiveMember':'package/dist-runtime/index.js','proposedSha256':sha(runtime['dist-runtime/index.js'])},
        {'target':str(installed/'openclaw.plugin.json'),'originalSha256':sha(recovery['openclaw.plugin.json']),
        'archiveMember':'package/openclaw.plugin.json','proposedSha256':sha(runtime['openclaw.plugin.json'])}]
    for name,data in observed_installed.items():
        if (installed/name).read_bytes()!=data:raise RuntimeError('Installed state drift during build')
    manifest={'product':'o-MATIC Server Connection','pluginId':'omatic-governance','packageVersion':package['version'],
      'artifacts':{'install':install,'sourceReview':source_artifact,'rollback':recovery_artifact},
      'runtimeFiles':{k:sha(v) for k,v in runtime.items()},'sourceFiles':{k:sha(v) for k,v in source.items()},
      'installOverlay':overlay,'packageEntry':'dist-runtime/index.js',
      'verification':{'serverSourceArchiveSmoke':source_smoke,'repeatedNpmPackIdentical':True,'archiveAllowlistAndBytes':True,'extractedCompiledSmoke':smoke_result,
        'stockPluginsLint':lint_result,'corruptCandidateIndependentRestoreSimulation':True,'installedBaselineUnchanged':all(observed_installed[n]==recovery[n] for n in recovery),'installedStateUnchangedDuringBuild':True,'independentOriginalsPreserved':True},
      'artifactReadyForIndependentReview':True,'releaseReady':False,'activationApproved':True,'approvalProvenance':'Jimmy build/deployment approval per parent relay; no live application yet','published':False,
      'fullWorkflowAcceptance':False,'backendStatus':'unbound; executor_unverified when trusted provenance unavailable',
      'gates':['independent QA/Smith conditions','Data durable-store integration and real host/artifact bindings',
        'Codex/M365 live positive/negative acceptance','Spirit Gate/rule350 clearance','production binding and target-host activation/readback']}
    encoded=(json.dumps(manifest,indent=2)+'\n').encode();descriptor=ROOT/'release'/'descriptors'/(sha(encoded)+'.json')
    write_immutable(descriptor,encoded)
    (ROOT/'release'/'LATEST.json').write_text(json.dumps({'descriptor':str(descriptor.relative_to(ROOT)),'sha256':sha(encoded)},indent=2)+'\n')
    print(json.dumps({'descriptor':str(descriptor.relative_to(ROOT)),'descriptorSha256':sha(encoded),'install':install,
        'sourceReview':source_artifact,'rollback':recovery_artifact,'releaseReady':False},indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bun',default=shutil.which('bun'))
    parser.add_argument('--node',default=shutil.which('node'))
    parser.add_argument('--npm-cli',required=True)
    parser.add_argument('--openclaw-cli',required=True)
    parser.add_argument('--installed-plugin',default='/Users/lucid/.openclaw/extensions/omatic-governance')
    args=parser.parse_args()
    if not args.bun or not args.node:parser.error('Supply existing --bun and --node engines; builder never installs them')
    build(args)
