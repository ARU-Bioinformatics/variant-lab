/* Executes the actual browser WASM modules in a Worker with a minimal browser API
 * shim. No canned tool results. Run: node tests/runtime.test.cjs from repo root.
 */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {Worker:NodeWorker}=require('node:worker_threads');
const root=path.resolve(__dirname,'..');
class BrowserWorker {
 constructor(source){
  const isData=source.startsWith('data:');
  const script=isData?Buffer.from(source.split(',')[1],'base64').toString():fs.readFileSync(path.join(root,new URL(source).pathname),'utf8');
  const setup=`const {parentPort}=require('node:worker_threads'),fs=require('node:fs'),vm=require('node:vm');
   global.process=undefined;global.self=global;self.location={href:${JSON.stringify(isData?'http://localhost/worker.js':source)},pathname:'/worker.js',toString(){return this.href;}};
   const disk=url=>${JSON.stringify(root)}+new URL(url,self.location.href).pathname;
   self.postMessage=(v,tr)=>parentPort.postMessage(v,tr);parentPort.on('message',e=>self.onmessage?.({data:e}));self.addEventListener=(n,fn)=>parentPort.on(n,e=>fn({data:e}));self.removeEventListener=()=>{};
   self.importScripts=(url)=>vm.runInThisContext(fs.readFileSync(disk(url),'utf8'),{filename:disk(url)});
   global.FileList=class {};global.File=class extends Blob {};
   global.XMLHttpRequest=class {open(method,url,async){this.url=url;this.async=async;}send(){try{const b=fs.readFileSync(disk(this.url));this.status=200;this.response=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);this.responseText=b.toString();this.onload?.({target:this});}catch(e){this.status=404;this.onerror?.(e);}}};
   global.fetch=async(url)=>new Response(fs.readFileSync(disk(url)),{headers:{'Content-Type':'application/wasm'}});
  `;
  this.worker=new NodeWorker(setup+script,{eval:true});this.worker.setMaxListeners(0);this.listeners=new Map();this.worker.on('error',e=>{console.error('WORKER',e);this.onerror?.({message:e.message});});this.worker.on('message',data=>this.onmessage?.({data}));
 }
 addEventListener(n,fn){const cb=e=>fn({data:e});this.listeners.set(fn,cb);this.worker.on(n,cb);}
 terminate(){return this.worker.terminate();}
 removeEventListener(n,fn){this.worker.off(n,this.listeners.get(fn));this.listeners.delete(fn);} postMessage(v,tr){this.worker.postMessage(v,tr);}
}
global.Worker=BrowserWorker;const Aioli=require(path.join(root,'assets/vendor/biowasm/aioli.js'));
global.window={Aioli,MG:{config:{biowasmBase:'http://localhost/assets/vendor/biowasm'},bus:{emit(){}},esc:String}};
global.location={href:'http://localhost/'};
global.fetch=async url=>{const u=new URL(url,location.href);return new Response(fs.readFileSync(path.join(root,u.pathname)));};
global.document={currentScript:{src:'http://localhost/assets/js/exactsnp.js'}};
for(const file of ['vfs','shell','tools-wasm','exactsnp'])vm.runInThisContext(fs.readFileSync(path.join(root,`assets/js/${file}.js`),'utf8'),{filename:file+'.js'});
const MG=window.MG;
const checks=[];
const report={
  environment:'Node Worker browser API shim; actual compiled WASM programs and production worker bridge',
  browserVisualQA:false,
  fullPairedBowtieCompleted:false,
  limitations:[
    'Default Bowtie2 tests limit each dataset to at most 100 read pairs, followed by a rerun with at most 10 pairs.',
    'The upstream Bowtie2 build emulates SIMD and is much slower than native code for paired alignment.',
    'Variant and genotype counts are observed pipeline outputs. They are not truth-set accuracy estimates.'
  ],
  datasets:[],checks
};
const fullBowtie=process.env.FULL_BOWTIE==='1';
const reportPath=path.resolve(root,process.env.RUNTIME_RESULTS||'tests/runtime-results.json');
const timeoutMs=Number(process.env.RUNTIME_TIMEOUT_MS)||(fullBowtie?1800000:300000);
const watchdog=setTimeout(()=>{console.error(`Test timeout after ${timeoutMs/1000} seconds`);process.exit(124);},timeoutMs);
const digest=b=>require('node:crypto').createHash('sha256').update(b).digest('hex');
const records=text=>text.split('\n').filter(x=>x&&!x.startsWith('@'));
function fastqInfo(text){
  const lines=text.trimEnd().split(/\r?\n/);assert.equal(lines.length%4,0,'FASTQ has complete four-line records');
  const lengths=[];for(let i=0;i<lines.length;i+=4){assert(lines[i].startsWith('@'));assert(lines[i+2].startsWith('+'));assert.equal(lines[i+1].length,lines[i+3].length);lengths.push(lines[i+1].length);}
  return {records:lengths.length,minLength:lengths.reduce((a,b)=>Math.min(a,b),Infinity),maxLength:lengths.reduce((a,b)=>Math.max(a,b),0)};
}
function variants(text){
  assert.match(text,/^#CHROM/m,'VCF header exists');
  const out={records:0,snpRecords:0,indelRecords:0,heterozygousGenotypes:0,heterozygousPassingQual20:0,heterozygousExamples:[],homozygousAlternateGenotypes:0,haploidAlternateGenotypes:0,missingGenotypes:0,samples:[]};
  for(const line of text.split('\n')){
    if(line.startsWith('#CHROM')){out.samples=line.split('\t').slice(9);continue;}
    if(!line||line.startsWith('#'))continue;
    const f=line.split('\t');out.records++;
    if(f[3].length===1&&f[4].split(',').every(a=>a.length===1))out.snpRecords++;else out.indelRecords++;
    const gtIndex=(f[8]||'').split(':').indexOf('GT');
    for(const sample of f.slice(9)){
      const gt=gtIndex<0?'.':sample.split(':')[gtIndex]||'.', alleles=gt.split(/[|/]/);
      if(alleles.includes('.'))out.missingGenotypes++;
      else if(new Set(alleles).size>1){out.heterozygousGenotypes++;if(Number(f[5])>=20)out.heterozygousPassingQual20++;if(out.heterozygousExamples.length<10){const values=Object.fromEntries((f[8]||'').split(':').map((key,i)=>[key,sample.split(':')[i]]));out.heterozygousExamples.push({contig:f[0],position:Number(f[1]),ref:f[3],alt:f[4],qual:Number(f[5]),genotype:gt,depth:values.DP?Number(values.DP):null,allelicDepth:values.AD?values.AD.split(',').map(Number):null});}}
      else if(alleles[0]!=='0'){if(alleles.length===1)out.haploidAlternateGenotypes++;else out.homozygousAlternateGenotypes++;}
    }
  }
  return out;
}
function tabular(text){const rows=text.trim().split('\n'),header=rows.shift().replace(/^#/,'').split('\t');return rows.filter(Boolean).map(r=>Object.fromEntries(r.split('\t').map((v,i)=>[header[i],Number.isFinite(Number(v))?Number(v):v])));}
(async()=>{
 const vfs=new MG.VFS();vfs.mkdirp('results');vfs.writeText('rows.tsv','b\t2\na\t1\na\t3\n');const shell=new MG.Shell({fs:vfs});
 async function run(cmd,expect=0){
  let out='',err='';const start=performance.now();const code=await shell.run(cmd,{out:x=>out+=x,err:x=>err+=x,note:()=>{}});
  const result={cmd,code,secs:(performance.now()-start)/1000,out:out.slice(0,120),err:err.slice(0,300)};checks.push(result);console.log(JSON.stringify(result));assert.equal(code,expect,cmd+'\n'+err);return out;
 }
 assert.equal(await run('cat rows.tsv'),'b\t2\na\t1\na\t3\n');
 await run('cat rows.tsv | sort | head -n 2 > results/out.tsv');assert.equal(await vfs.readText('results/out.tsv'),'a\t1\na\t3\n');
 assert.equal(await run("awk '{s+=$2} END {print s}' rows.tsv"),'6\n');
 await run('grep -q missing rows.tsv',1);await run('cat --definitely-not-an-option rows.tsv',1);assert.equal(await run('cat rows.tsv'),'b\t2\na\t1\na\t3\n');
 await run('samtools no_such_subcommand',1);await run('cat missing > results/merged.txt 2>&1',1);assert.match(await vfs.readText('results/merged.txt'),/No such file/);assert.equal(await run('cat missing && echo WRONG',1),'');
 await run('tr a-z A-Z < rows.tsv > results/upper.tsv');assert.equal(await vfs.readText('results/upper.tsv'),'B\t2\nA\t1\nA\t3\n');
 await run('samtools --version');await run('minimap2 --version');
 const inputManifest=JSON.parse(fs.readFileSync(path.resolve(root,process.env.RUNTIME_MANIFEST||'data/manifest.json')));
 const manifest=Array.isArray(inputManifest.datasets)?inputManifest:{datasets:[inputManifest]};
 assert(manifest.datasets.length,'Manifest contains datasets');
 for(const data of manifest.datasets){
  assert(!/simulat|synthetic/i.test(data.readSource||''),`${data.id}: expected biological sequencing reads, not simulated data`);
  assert(/^[a-zA-Z0-9_-]+$/.test(data.id),'Dataset ID safe for shell paths');
  const dir='datasets/'+data.id,out='results/'+data.id;vfs.mkdirp(dir);vfs.mkdirp(out);
  const item={id:data.id,name:data.name,readSource:data.readSource,species:data.species,assembly:data.assembly,ploidy:data.ploidy,provenance:data.provenance||null,inputs:{},minimap2:{},bowtie2:{}};report.datasets.push(item);
  for(const [name,src] of [['reference.fa',data.reference],['R1.fastq',data.read1],['R2.fastq',data.read2]])if(src){
    const bytes=fs.readFileSync(path.join(root,src));assert(!src.endsWith('.gz'),'Bundle uncompressed FASTQ/FASTA for the direct Bowtie2 binary');vfs.writeText(dir+'/'+name,bytes.toString('utf8'));
    item.inputs[name]={source:src,bytes:bytes.length,sha256:digest(bytes),...(name.endsWith('.fastq')?fastqInfo(bytes.toString('utf8')):{})};
  }
  const paired=!!data.read2,pairs=item.inputs['R1.fastq'].records;if(paired)assert.equal(pairs,item.inputs['R2.fastq'].records,'Paired files have equal record counts');
  const ploidyArg=data.ploidy===1?'--ploidy 1':'';assert([1,2].includes(data.ploidy),'Teaching datasets declare haploid or diploid model');
  const reference=dir+'/reference.fa',r1=dir+'/R1.fastq',r2=dir+'/R2.fastq',reads=r1+(paired?' '+r2:'');
  await run(`minimap2 -ax sr ${reference} ${reads} | samtools sort -o ${out}/mm.bam`);
  await run(`samtools index ${out}/mm.bam`);await run(`samtools quickcheck ${out}/mm.bam`);
  item.minimap2.primaryRecords=Number((await run(`samtools view -c -F 2304 ${out}/mm.bam`)).trim());
  item.minimap2.mappedPrimaryRecords=Number((await run(`samtools view -c -F 2308 ${out}/mm.bam`)).trim());
  item.minimap2.properlyPairedPrimaryRecords=Number((await run(`samtools view -c -f 2 -F 2304 ${out}/mm.bam`)).trim());
  item.minimap2.coverage=tabular(await run(`samtools coverage ${out}/mm.bam`));
  assert.equal(item.minimap2.primaryRecords,pairs*(paired?2:1),'Alignment preserves every input read as a primary record');
  assert(item.minimap2.mappedPrimaryRecords>0,'At least some sequenced reads align to their declared reference');
  for(const [name,flag] of [['multiallelic','-mv'],['consensus','-cv']]){
    await run(`bcftools mpileup -Ou -a AD,DP -f ${reference} ${out}/mm.bam | bcftools call ${flag} ${ploidyArg} -Ov -o ${out}/mm-${name}.vcf`);
    item.minimap2[name]=variants(await vfs.readText(`${out}/mm-${name}.vcf`));
  }
  await run(`exactSNP -b -i ${out}/mm.bam -g ${reference} -o ${out}/exact.vcf`);
  item.exactSNP=variants(await vfs.readText(`${out}/exact.vcf`));
  await run(`bcftools norm -f ${reference} -m -any -Ov -o ${out}/exact-normalized.vcf ${out}/exact.vcf`);
  item.exactSNP.normalized=variants(await vfs.readText(`${out}/exact-normalized.vcf`));
  if(data.id==='human'&&data.ploidy===2)assert(item.minimap2.multiallelic.heterozygousGenotypes>0,'Human diploid example should expose real heterozygous genotype calls');
  await run(`samtools view -b ${out}/mm.bam > ${out}/copy.bam`);await run(`samtools quickcheck ${out}/copy.bam`);
  await run(`cat ${out}/copy.bam > ${out}/copy2.bam`);assert.deepEqual(await vfs.readBytes(`${out}/copy.bam`),await vfs.readBytes(`${out}/copy2.bam`));
  if(data.bowtie2Files?.length){
    for(const src of data.bowtie2Files)vfs.put(dir+'/'+path.basename(src),{kind:'blob',blob:new Blob([fs.readFileSync(path.join(root,src))])});
    const index=dir+'/'+path.basename(data.bowtie2Index||data.reference.replace(/\.fa(sta)?$/,'')),selection=paired?`-1 ${r1} -2 ${r2}`:`-U ${r1}`;
    for(const limit of [Math.min(pairs,fullBowtie?pairs:100),Math.min(pairs,10)]){
      const target=`${out}/bt-${limit}.sam`;await run(`bowtie2 -u ${limit} -x ${index} ${selection} -S ${target}`);
      const n=records(await vfs.readText(target)).length;item.bowtie2[`${limit}${paired?'Pairs':'Reads'}`]={primaryRecords:n};assert.equal(n,limit*(paired?2:1),'Bowtie2 results reflect input limit on repeated calls');
    }
    const limit=Math.min(pairs,fullBowtie?pairs:100);await run(`samtools sort -o ${out}/bt.bam ${out}/bt-${limit}.sam`);
    await run(`bcftools mpileup -Ou -a AD,DP -f ${reference} ${out}/bt.bam | bcftools call -mv ${ploidyArg} -Ov -o ${out}/bt.vcf`);
    item.bowtie2.multiallelic=variants(await vfs.readText(`${out}/bt.vcf`));
  }else item.bowtie2.skipped='No Bowtie2 index supplied in manifest';
 }
 report.fullPairedBowtieCompleted=fullBowtie;
 fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');clearTimeout(watchdog);
 console.log('PASS: real sequencing inputs; observed mapping, variant and genotype counts; byte-preserving pipelines; bounded aligner reruns.');process.exit(0);
})().catch(e=>{report.failure=String(e.stack||e);fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.error(e);process.exit(1);});
