const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const {JSDOM,requestInterceptor,VirtualConsole}=require('jsdom');
const root=path.resolve(__dirname,'..');
const resources={interceptors:[requestInterceptor(request=>new Response(fs.readFileSync(path.join(root,new URL(request.url).pathname)),{headers:{'Content-Type':request.url.endsWith('.css')?'text/css':'application/javascript'}}))]};
const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/navigation/.test(e.message))errors.push(e.message)});vc.on('error',e=>errors.push(String(e)));
const dom=new JSDOM(fs.readFileSync(root+'/index.html','utf8'),{url:'http://variant-lab.test/',runScripts:'dangerously',resources,pretendToBeVisual:true,virtualConsole:vc,beforeParse(w){w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;w.Blob=Blob;w.Response=Response;w.fetch=async url=>new Response(fs.readFileSync(path.join(root,new URL(url,w.location.href).pathname)));w.matchMedia=()=>({matches:false,addListener(){},removeListener(){}});w.URL.createObjectURL=()=> 'blob:qa';w.URL.revokeObjectURL=()=>{};}});

async function testEditorUI(w) {
  const doc = w.document, app = w.MG.app;
  const waitFor = async find => { for (let i = 0; i < 300; i++) { if (find()) return find(); await new Promise(r => setTimeout(r, 10)); } throw Error('Editor UI did not reach expected state'); };
  const dialog = () => doc.querySelector('.nano-overlay [role="dialog"][aria-label="Text editor"]');
  async function saveAndExit(text, filename) {
    const editor = await waitFor(dialog), buffer = editor.querySelector('.nano-buffer');
    buffer.value = text; buffer.dispatchEvent(new w.Event('input', {bubbles: true}));
    editor.querySelector('[data-editor-action="save"]').click();
    const prompt = await waitFor(() => doc.querySelector('[data-editor-prompt="filename"]'));
    prompt.querySelector('[data-editor-filename]').value = filename;
    prompt.querySelector('[data-editor-action="confirm-save"]').click();
    await waitFor(() => !doc.querySelector('[data-editor-prompt="filename"]'));
    assert.equal(app.term.busy, true, 'Saving leaves the interactive command active');
    editor.querySelector('[data-editor-action="exit"]').click();
  }
  let finished = false;
  const terminalRun = app.term.exec('nano "results/editor-ui.txt" && echo editor-finished').then(code => { finished = true; return code; });
  await waitFor(dialog); assert.equal(app.term.busy, true); assert.equal(finished, false);
  const queued = app.term.exec('echo queued > results/queued-after-editor.txt');
  assert.equal(app.fs.exists('results/queued-after-editor.txt'), false, 'Queued commands wait for the editor');
  doc.querySelector('#datasetSelect').value = 'yeast';
  doc.querySelector('#datasetSelect').dispatchEvent(new w.Event('change'));
  assert.equal(app.active.id, 'human', 'Dataset switching is blocked while editing');
  assert.equal(doc.querySelector('#datasetSelect').value, 'human');
  await saveAndExit('edited in the terminal\n', 'results/editor-ui.txt');
  assert.equal(await terminalRun, 0); assert.equal(await queued, 0);
  assert.equal(await app.fs.readText('results/editor-ui.txt'), 'edited in the terminal\n');
  assert.equal(await app.fs.readText('results/queued-after-editor.txt'), 'queued\n');
  assert.equal(app.term.busy, false);
  doc.querySelector('[data-tab="galaxy"]').click();
  const tool = [...doc.querySelectorAll('.gl-tool')].find(button => button.querySelector('strong')?.textContent === 'Text editor');
  assert(tool, 'Galaxy text editor tool is visible'); tool.click();
  const filename = doc.querySelector('#galaxyRoot input[name="filename"]');
  filename.value = 'results/galaxy-editor.txt'; filename.dispatchEvent(new w.Event('input', {bubbles: true}));
  doc.querySelector('#galaxyRoot .gl-run').click(); await waitFor(dialog);
  assert.equal(app.galaxy.jobs.at(-1).status, 'running');
  await saveAndExit('edited through Galaxy\n', 'results/galaxy-editor.txt');
  await waitFor(() => app.galaxy.jobs.at(-1).status === 'success');
  assert.equal(await app.fs.readText('results/galaxy-editor.txt'), 'edited through Galaxy\n');
  assert(app.galaxy.jobs.at(-1).outputs.some(p => p.endsWith('/results/galaxy-editor.txt')), 'Galaxy records the edited output');
  console.log('PASS: terminal/Galaxy editor entry, command queue, busy state and dataset lock');
}

(async()=>{const w=dom.window;for(let i=0;i<100&&!w.MG?.app?.active;i++)await new Promise(r=>setTimeout(r,30));assert.equal(w.MG.app.active.id,'human');assert.equal(errors.length,0,errors.join('\n'));const doc=w.document;assert.equal(doc.querySelector('#compareTruth'),null);assert.match(doc.querySelector('#datasetInfo').textContent,/Sequencing reads; no variants have been added/);assert(![...w.MG.app.fs.entries.keys()].some(p=>p.endsWith('/truth.vcf')));console.log('initial files',w.MG.app.fs.entries.size);assert.equal(doc.querySelectorAll('.gl-tool').length,14);doc.querySelector('[data-tab="galaxy"]').click();assert.equal(doc.querySelector('#galaxyPanel').hidden,false);assert.equal(doc.querySelector('#terminalPanel').hidden,true);const code=await w.MG.app.term.exec('echo testing > results/note.txt');assert.equal(code,0);assert.equal(await w.MG.app.fs.readText('results/note.txt'),'testing\n');await testEditorUI(w);doc.querySelector('#datasetSelect').value='yeast';doc.querySelector('#datasetSelect').dispatchEvent(new w.Event('change'));for(let i=0;i<100&&w.MG.app.active.id!=='yeast';i++)await new Promise(r=>setTimeout(r,30));assert.equal(w.MG.app.active.id,'yeast');assert.match(doc.querySelector('#scriptEditor').value,/--ploidy 1/);assert.equal(w.MG.app.fs.exists('/home/student/human/results/note.txt'),true);doc.querySelector('#recipeCaller').value='exactSNP';doc.querySelector('#refreshRecipe').click();assert.match(doc.querySelector('#scriptEditor').value,/exactSNP -b/);assert(!/bcftools call/.test(doc.querySelector('#scriptEditor').value));doc.querySelector('#notebook').value='hypothesis';doc.querySelector('#notebook').dispatchEvent(new w.Event('input'));assert.equal(w.MG.store.get('notebook'),'hypothesis');doc.querySelector('[data-tab="compare"]').click();assert.equal(doc.querySelector('#comparePanel').hidden,false);doc.querySelector('#compareButton').click();assert.match(doc.querySelector('#notice').textContent,/Choose two/);assert.equal(errors.length,0,errors.join('\n'));let exported;w.MG.downloadBlob=(blob,name)=>{exported={blob,name}};doc.querySelector('#exportSession').click();for(let i=0;i<100&&!exported;i++)await new Promise(r=>setTimeout(r,30));assert(exported,'experiment export');const archive=Buffer.from(await exported.blob.arrayBuffer());assert.match(archive.toString('utf8'),/experiment.json/);assert.match(archive.toString('utf8'),/hypothesis/);assert.match(archive.toString('utf8'),/note.txt/);console.log('PASS: export archive, page initialization, tabs, terminal journaling, shared files, dataset switching, recipes, notes and empty comparison state');w.close();})().catch(e=>{console.error(e,errors);dom.window.close();process.exitCode=1});
