/* Galaxy-inspired tool runner. Every form executes the same browser tools and
 * filesystem as the terminal; no recorded bioinformatics output is substituted. */
(function () {
  'use strict';

  const quote = value => {
    const s = String(value == null ? '' : value);
    return /^[A-Za-z0-9_./:=,+@%-]+$/.test(s) ? s : "'" + s.replace(/'/g, "'\\''") + "'";
  };
  const extra = v => v.extra && v.extra.trim() ? ' ' + v.extra.trim() : '';
  const field = (key, label, initial, options) => Object.assign({ key, label, initial, required: true, type: 'text' }, options || {});
  const path = (key, label, name, options) => field(key, label, base => base + '/' + name, Object.assign({ file: true }, options));
  const advanced = () => field('extra', 'Additional arguments', '', { required: false, placeholder: 'Optional flags; use the command preview to check them.', wide: true });
  const output = name => path('out', 'Output file', name, { output: true, wide: true });
  const TOOLS = [
    {
      id: 'minimap2', group: 'Align reads', title: 'Minimap2', tag: 'Minimiser seeds',
      description: 'Align reads using minimiser seeds and chaining. Choose sr for short reads. Compare alignments in repetitive or ambiguous regions with Bowtie2.',
      fields: [path('ref', 'Reference FASTA', 'reference.fa'), field('preset', 'Preset', 'sr', { type: 'select', options: [['sr', 'sr — short reads'], ['map-ont', 'map-ont — Nanopore'], ['map-pb', 'map-pb — PacBio CLR'], ['map-hifi', 'map-hifi — high-fidelity long reads']] }), path('r1', 'Reads / mate 1', 'reads_R1.fastq'), path('r2', 'Mate 2 (optional)', 'reads_R2.fastq', { required: false }), advanced(), output('minimap2.sam')],
      command: v => 'minimap2 -ax ' + quote(v.preset) + extra(v) + ' ' + quote(v.ref) + ' ' + quote(v.r1) + (v.r2.trim() ? ' ' + quote(v.r2) : '') + ' > ' + quote(v.out)
    },
    {
      id: 'bowtie2', group: 'Align reads', title: 'Bowtie2', tag: 'FM index',
      description: 'Align reads using a Bowtie2 index. Enter the index prefix without .1.bt2 or another suffix. Additional arguments let you change sensitivity or use local alignment.',
      fields: [path('index', 'Bowtie2 index prefix', 'reference'), path('r1', 'Reads / mate 1', 'reads_R1.fastq'), path('r2', 'Mate 2 (optional)', 'reads_R2.fastq', { required: false }), advanced(), output('bowtie2.sam')],
      command: v => 'bowtie2 -x ' + quote(v.index) + (v.r2.trim() ? ' -1 ' + quote(v.r1) + ' -2 ' + quote(v.r2) : ' -U ' + quote(v.r1)) + extra(v) + ' -S ' + quote(v.out)
    },
    {
      id: 'faidx', group: 'Prepare and inspect', title: 'Index reference', tag: 'samtools faidx',
      description: 'Index a FASTA reference. The output has the same filename with .fai added.',
      fields: [path('ref', 'Reference FASTA', 'reference.fa')],
      command: v => 'samtools faidx ' + quote(v.ref)
    },
    {
      id: 'sort', group: 'Prepare and inspect', title: 'Sort alignments', tag: 'samtools sort',
      description: 'Sort alignments by genomic coordinate and write a BAM file for indexing and variant calling.',
      fields: [path('input', 'Input SAM / BAM', 'minimap2.sam'), advanced(), output('minimap2.sorted.bam')],
      command: v => 'samtools sort' + extra(v) + ' -o ' + quote(v.out) + ' ' + quote(v.input)
    },
    {
      id: 'index', group: 'Prepare and inspect', title: 'Index alignments', tag: 'samtools index',
      description: 'Index a coordinate-sorted BAM so that tools can read alignments from a selected region.',
      fields: [path('input', 'Coordinate-sorted BAM', 'minimap2.sorted.bam'), advanced()],
      command: v => 'samtools index' + extra(v) + ' ' + quote(v.input)
    },
    {
      id: 'flagstat', group: 'Prepare and inspect', title: 'Alignment summary', tag: 'samtools flagstat',
      description: 'Count mapped reads, properly paired reads and other SAM flag categories. Compare these counts between aligners.',
      fields: [path('input', 'Input SAM / BAM', 'minimap2.sorted.bam'), advanced(), output('alignment-summary.txt')],
      command: v => 'samtools flagstat' + extra(v) + ' ' + quote(v.input) + ' > ' + quote(v.out)
    },
    {
      id: 'depth', group: 'Prepare and inspect', title: 'Coverage depth', tag: 'samtools depth',
      description: 'Write the read depth at each position. The -a option includes positions with no coverage. Depth alone does not show whether a variant call is reliable.',
      fields: [path('input', 'Input BAM', 'minimap2.sorted.bam'), field('extra', 'Additional arguments', '-a', { required: false, wide: true }), output('depth.tsv')],
      command: v => 'samtools depth' + extra(v) + ' ' + quote(v.input) + ' > ' + quote(v.out)
    },
    {
      id: 'mpileup', group: 'Call variants', title: 'Genotype likelihoods', tag: 'bcftools mpileup',
      description: 'Calculate genotype likelihoods from alignments and a matching reference. Use the output with either bcftools calling model. Changing the mapping and base quality thresholds changes which reads and bases contribute.',
      fields: [path('ref', 'Reference FASTA', 'reference.fa'), path('input', 'Input BAM', 'minimap2.sorted.bam'), field('mapq', 'Minimum mapping quality', '20', { type: 'number', min: 0, max: 255 }), field('baseq', 'Minimum base quality', '20', { type: 'number', min: 0, max: 255 }), advanced(), output('minimap2.likelihoods.bcf')],
      command: v => 'bcftools mpileup -f ' + quote(v.ref) + ' -q ' + quote(v.mapq) + ' -Q ' + quote(v.baseq) + ' -a FORMAT/AD,FORMAT/DP' + extra(v) + ' -Ob -o ' + quote(v.out) + ' ' + quote(v.input)
    },
    {
      id: 'call', group: 'Call variants', title: 'Call genotypes', tag: 'bcftools call',
      description: 'Call variants with the multiallelic (-m) or consensus (-c) model in bcftools. Choose the ploidy for your dataset and save each run to a separate file.',
      fields: [path('input', 'Likelihoods BCF / VCF', 'minimap2.likelihoods.bcf'), field('model', 'Calling model', '-m', { type: 'select', options: [['-m', 'Multiallelic (-m)'], ['-c', 'Consensus (-c)']] }), field('ploidy', 'Ploidy', '2', { type: 'select', options: [['2', 'Diploid (2; default)'], ['1', 'Haploid (1)']] }), advanced(), output('minimap2.multiallelic.vcf')],
      command: v => 'bcftools call ' + v.model + (String(v.ploidy) === '1' ? ' --ploidy 1' : '') + ' -v' + extra(v) + ' -Ov -o ' + quote(v.out) + ' ' + quote(v.input)
    },
    {
      id: 'exactsnp', group: 'Call variants', title: 'exactSNP', tag: 'Subread',
      description: 'Call SNPs and simple CIGAR-derived indels from a coordinate-sorted BAM. exactSNP does not report sample genotypes. SNP QUAL is min(40, −log10(p)); indel QUAL is fixed at 1. These are not Phred scores, so choose filters appropriate to this caller.',
      fields: [path('input', 'Coordinate-sorted BAM', 'minimap2.sorted.bam'), path('ref', 'Reference FASTA', 'reference.fa'), advanced(), output('minimap2.exactsnp.vcf')],
      command: v => 'exactSNP -b -i ' + quote(v.input) + ' -g ' + quote(v.ref) + extra(v) + ' -o ' + quote(v.out)
    },
    {
      id: 'norm', group: 'Compare and filter', title: 'Normalise variants', tag: 'bcftools norm',
      description: 'Left-align indels against the reference and split multiallelic records. Normalise both call sets before comparing them, as the same variant can be represented in different ways.',
      fields: [path('ref', 'Reference FASTA', 'reference.fa'), path('input', 'Input VCF / BCF', 'minimap2.multiallelic.vcf'), advanced(), output('minimap2.multiallelic.normalized.vcf')],
      command: v => 'bcftools norm -f ' + quote(v.ref) + ' -m -any' + extra(v) + ' ' + quote(v.input) + ' -Ov -o ' + quote(v.out)
    },
    {
      id: 'filter', group: 'Compare and filter', title: 'Filter variants', tag: 'bcftools filter',
      description: 'Keep records that match a bcftools expression. Save each result separately and check which calls were removed. Quality scales differ between callers: exactSNP QUAL is not Phred-scaled, so use a suitable threshold for each caller.',
      fields: [path('input', 'Input VCF / BCF', 'minimap2.multiallelic.normalized.vcf'), field('expression', 'Include expression', 'QUAL>=20', { wide: true }), advanced(), output('minimap2.multiallelic.filtered.vcf')],
      command: v => 'bcftools filter -i ' + quote(v.expression) + extra(v) + ' -Ov -o ' + quote(v.out) + ' ' + quote(v.input)
    },
    {
      id: 'nano', group: 'Other commands', title: 'Text editor', tag: 'nano',
      description: 'Create or edit a text file. Save with Ctrl+O and Enter, then exit with Ctrl+X. The editor uses the same files as the terminal. It supports UTF-8 text up to 2 MiB.',
      fields: [path('filename', 'File to create or edit', 'notes.txt', { required: false, wide: true })],
      command: v => 'nano' + (v.filename.trim() ? ' -- ' + quote(v.filename) : '')
    },
    {
      id: 'custom', group: 'Other commands', title: 'Custom command', tag: 'Shell',
      description: 'Run a shell command. Type help in the terminal for available commands and supported syntax. Files are shared with the terminal and other tools.',
      fields: [field('command', 'Command', base => 'ls -lh ' + quote(base), { type: 'textarea', wide: true })],
      command: v => v.command.trim()
    }
  ];

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function installStyle() {
    if (document.getElementById('lab-galaxy-style')) return;
    const style = el('style');
    style.id = 'lab-galaxy-style';
    style.textContent = `
      .galaxy-lab { display:grid; grid-template-columns:184px minmax(280px,1fr) 266px; min-height:610px; border:1px solid #d9e2e7; background:#fff; border-radius:12px; overflow:hidden; color:#24353e; font-size:13px; }
      .galaxy-lab * { box-sizing:border-box; }
      .galaxy-lab button, .galaxy-lab input, .galaxy-lab select, .galaxy-lab textarea { font:inherit; }
      .galaxy-lab button { cursor:pointer; }
      .galaxy-lab button:focus-visible, .galaxy-lab input:focus-visible, .galaxy-lab select:focus-visible, .galaxy-lab textarea:focus-visible, .galaxy-lab summary:focus-visible { outline:2px solid #16746d; outline-offset:2px; }
      .galaxy-lab .gl-tools { padding:18px 10px; background:#f4f7f8; border-right:1px solid #dfe6e8; }
      .galaxy-lab .gl-column-title { margin:0 8px 14px; font-size:14px; font-weight:750; }
      .galaxy-lab .gl-group-title { margin:20px 9px 7px; font-size:10px; text-transform:uppercase; letter-spacing:.1em; font-weight:750; color:#61757b; }
      .galaxy-lab .gl-tool { display:block; width:100%; text-align:left; border:1px solid transparent; border-radius:7px; margin:3px 0; padding:9px 10px; background:transparent; color:inherit; line-height:1.25; }
      .galaxy-lab .gl-tool:hover { background:#e8f0f0; }
      .galaxy-lab .gl-tool[aria-pressed="true"] { background:#e0f1ee; color:#155f58; border-color:#b8dcd5; }
      .galaxy-lab .gl-tool strong { display:block; font-size:12px; font-weight:650; }
      .galaxy-lab .gl-tool small { display:block; color:#65797f; font-size:10px; margin-top:4px; }
      .galaxy-lab .gl-workspace { min-width:0; padding:25px 25px 22px; }
      .galaxy-lab .gl-eyebrow { color:#1b756c; text-transform:uppercase; font-size:10px; font-weight:750; letter-spacing:.1em; margin-bottom:7px; }
      .galaxy-lab .gl-heading { font-size:24px; line-height:1.15; margin:0 0 12px; letter-spacing:-.035em; }
      .galaxy-lab .gl-description { font-size:12px; color:#64747b; line-height:1.65; margin:0 0 22px; }
      .galaxy-lab .gl-form-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:15px; }
      .galaxy-lab .gl-field { display:flex; flex-direction:column; min-width:0; gap:6px; font-size:11px; font-weight:650; }
      .galaxy-lab .gl-field-wide { grid-column:1/-1; }
      .galaxy-lab .gl-field input, .galaxy-lab .gl-field select, .galaxy-lab .gl-field textarea { width:100%; min-width:0; padding:9px 10px; border:1px solid #cfdcde; border-radius:6px; background:#fff; color:#2c4148; font-size:11px; font-weight:400; }
      .galaxy-lab .gl-field input, .galaxy-lab .gl-field textarea { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
      .galaxy-lab .gl-field textarea { min-height:100px; resize:vertical; }
      .galaxy-lab .gl-hint { color:#6c7d84; font-size:10px; font-weight:400; line-height:1.5; margin:9px 0; }
      .galaxy-lab .gl-command-block { margin-top:23px; border:1px solid #dfe7e9; border-radius:7px; overflow:hidden; background:#f6f9f9; }
      .galaxy-lab .gl-command-top { padding:8px 12px; display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #e2e9eb; font-size:10px; color:#60727b; font-weight:650; }
      .galaxy-lab .gl-command { white-space:pre-wrap; overflow-wrap:anywhere; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:11px; line-height:1.7; padding:13px; margin:0; color:#244b53; max-height:260px; overflow:auto; }
      .galaxy-lab .gl-small-button { border:1px solid #cedbde; border-radius:5px; padding:4px 8px; background:white; font-size:10px; color:#315f65; }
      .galaxy-lab .gl-run-row { display:flex; align-items:center; gap:12px; margin-top:17px; }
      .galaxy-lab .gl-run { border:0; border-radius:6px; background:#166f65; color:#fff; font-weight:650; padding:10px 18px; font-size:12px; }
      .galaxy-lab .gl-run:hover { background:#0c5c54; }
      .galaxy-lab .gl-status { color:#607680; font-size:11px; }
      .galaxy-lab .gl-history { border-left:1px solid #dfe6e8; padding:18px 13px; background:#fafcfc; min-width:0; }
      .galaxy-lab .gl-history .gl-column-title { margin-left:0; }
      .galaxy-lab .gl-empty { font-size:11px; color:#718289; line-height:1.6; padding:12px 0; }
      .galaxy-lab .gl-job { display:block; width:100%; text-align:left; border:1px solid #dce5e7; border-left:3px solid #93a8b0; border-radius:6px; padding:10px; background:white; margin:8px 0; color:#28404a; }
      .galaxy-lab .gl-job[data-status="success"] { border-left-color:#399878; }
      .galaxy-lab .gl-job[data-status="error"] { border-left-color:#c3594c; }
      .galaxy-lab .gl-job[data-status="running"] { border-left-color:#4e8ba6; }
      .galaxy-lab .gl-job strong { display:block; font-size:11px; font-weight:650; }
      .galaxy-lab .gl-job small { display:block; margin-top:5px; color:#708089; font-size:10px; }
      .galaxy-lab .gl-job[aria-pressed="true"] { background:#edf5f4; }
      .galaxy-lab .gl-file-list { margin-top:20px; border-top:1px solid #e0e7e9; padding-top:14px; }
      .galaxy-lab .gl-file-list summary { cursor:pointer; font-weight:650; font-size:12px; }
      .galaxy-lab .gl-file-items { max-height:340px; overflow:auto; margin-top:9px; }
      .galaxy-lab .gl-file { display:block; width:100%; background:transparent; border:0; border-radius:4px; text-align:left; padding:6px 4px; color:#35646b; font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:10px; overflow-wrap:anywhere; }
      .galaxy-lab .gl-file:hover { background:#e6f0ef; }
      .galaxy-lab .gl-job-detail { margin-top:26px; border-top:1px solid #dce5e7; padding-top:20px; }
      .galaxy-lab .gl-job-detail h3 { margin:0 0 8px; font-size:14px; }
      .galaxy-lab .gl-job-detail .gl-log { white-space:pre-wrap; overflow-wrap:anywhere; font:10px/1.65 ui-monospace,SFMono-Regular,Consolas,monospace; max-height:220px; overflow:auto; background:#f3f6f7; border-radius:6px; padding:11px; }
      .galaxy-lab .gl-error { color:#a13b31; }
      @media(max-width:1120px) { .galaxy-lab { grid-template-columns:157px minmax(250px,1fr) 217px; } .galaxy-lab .gl-workspace { padding:21px 17px; } .galaxy-lab .gl-form-grid { grid-template-columns:1fr; } }
      @media(max-width:800px) { .galaxy-lab { grid-template-columns:145px minmax(0,1fr); } .galaxy-lab .gl-history { grid-column:1/-1; border-left:0; border-top:1px solid #dfe6e8; } .galaxy-lab .gl-history-jobs { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; } .galaxy-lab .gl-job { margin:0; } }
      @media(max-width:500px) { .galaxy-lab { grid-template-columns:1fr; } .galaxy-lab .gl-tools { border-right:0; border-bottom:1px solid #dfe6e8; max-height:230px; overflow:auto; } .galaxy-lab .gl-tool { display:inline-block; width:calc(50% - 4px); vertical-align:top; } .galaxy-lab .gl-group-title { margin-top:10px; } .galaxy-lab .gl-workspace { padding:20px 15px; } }
    `;
    document.head.append(style);
  }

  class LabGalaxy {
    constructor(root, options) {
      this.root = typeof root === 'string' ? document.querySelector(root) : root;
      if (!this.root) throw new Error('Galaxy runner needs a root element.');
      this.fs = options.fs;
      this.run = options.run;
      this.onSelectFile = options.onSelectFile;
      this.id = 'lab-galaxy-' + Math.random().toString(36).slice(2, 9);
      this.jobs = [];
      this.values = {};
      this.datasetValues = new Map();
      this.toolId = 'minimap2';
      this.base = '/home/student/human';
      this.datasetId = 'human';
      installStyle();
      this.build();
      this.setDataset('human');
      if (this.fs.onChange) this.fs.onChange(() => this.refresh());
    }

    build() {
      this.root.classList.add('galaxy-lab');
      this.root.replaceChildren();
      const nav = el('nav', 'gl-tools');
      nav.setAttribute('aria-label', 'Variant analysis tools');
      nav.append(el('h2', 'gl-column-title', 'Tools'));
      this.toolButtons = new Map();
      let group = '';
      TOOLS.forEach(tool => {
        if (group !== tool.group) {
          group = tool.group;
          nav.append(el('div', 'gl-group-title', group));
        }
        const button = el('button', 'gl-tool');
        button.type = 'button';
        button.append(el('strong', '', tool.title), el('small', '', tool.tag));
        button.addEventListener('click', () => this.selectTool(tool.id));
        this.toolButtons.set(tool.id, button);
        nav.append(button);
      });
      this.center = el('section', 'gl-workspace');
      this.center.setAttribute('aria-label', 'Tool settings and job details');
      this.formRegion = el('div');
      this.detailRegion = el('div');
      this.center.append(this.formRegion, this.detailRegion);
      const history = el('aside', 'gl-history');
      history.setAttribute('aria-label', 'Analysis history and files');
      this.historyTitle = el('h2', 'gl-column-title', 'History');
      this.historyJobs = el('div', 'gl-history-jobs');
      const fileDetails = el('details', 'gl-file-list');
      fileDetails.open = true;
      this.fileSummary = el('summary', '', 'Files');
      this.fileItems = el('div', 'gl-file-items');
      const fileHint = el('p', 'gl-hint', (this.onSelectFile ? 'Click a file to inspect it.' : 'Click a file to copy its path.') + ' Type or choose any path in a tool input.');
      fileDetails.append(this.fileSummary, fileHint, this.fileItems);
      history.append(this.historyTitle, el('p', 'gl-hint', 'All tools share files with the terminal.'), this.historyJobs, fileDetails);
      this.choices = el('datalist');
      this.choices.id = this.id + '-files';
      this.root.append(nav, this.center, history, this.choices);
    }

    setDataset(dataset) {
      if (this.datasetId) this.datasetValues.set(this.datasetId, this.values);
      const info = typeof dataset === 'string' ? { id: dataset } : (dataset || { id: 'human' });
      this.datasetId = info.id || 'human';
      this.base = info.root || info.basePath || info.path || '/home/student/' + this.datasetId;
      this.base = this.base.replace(/\/$/, '');
      this.values = this.datasetValues.get(this.datasetId) || {};
      this.defaultPloidy = String(info.ploidy || (/yeast|mito/i.test(this.datasetId) ? 1 : 2));
      this.selectedJob = null;
      this.selectTool(this.toolId);
      this.refresh();
    }

    toolValues(tool) {
      if (!this.values[tool.id]) {
        const values = {};
        tool.fields.forEach(f => { values[f.key] = typeof f.initial === 'function' ? f.initial(this.base) : f.initial; });
        if (tool.id === 'call') values.ploidy = this.defaultPloidy || '2';
        this.values[tool.id] = values;
      }
      return this.values[tool.id];
    }

    suggestedOutput(tool, values) {
      const input = (values.input || '').replace(/\.(sam|bam|bcf|vcf)(\.gz)?$/i, '');
      if (!input) return null;
      if (tool.id === 'sort') return input + '.sorted.bam';
      if (tool.id === 'mpileup') return input.replace(/\.sorted$/, '') + '.likelihoods.bcf';
      if (tool.id === 'call') return input.replace(/\.likelihoods$/, '') + (values.model === '-c' ? '.consensus.vcf' : '.multiallelic.vcf');
      if (tool.id === 'exactsnp') return input.replace(/\.sorted$/, '') + '.exactsnp.vcf';
      if (tool.id === 'norm') return input + '.normalized.vcf';
      if (tool.id === 'filter') return input.replace(/\.normalized$/, '') + '.filtered.vcf';
      return null;
    }

    selectTool(id) {
      const tool = TOOLS.find(t => t.id === id);
      if (!tool) return;
      this.toolId = id;
      this.toolButtons.forEach((button, key) => button.setAttribute('aria-pressed', String(key === id)));
      const values = this.toolValues(tool);
      this.formRegion.replaceChildren();
      this.formRegion.append(el('div', 'gl-eyebrow', tool.group), el('h2', 'gl-heading', tool.title), el('p', 'gl-description', tool.description));
      const form = el('form');
      const grid = el('div', 'gl-form-grid');
      tool.fields.forEach(f => {
        const label = el('label', 'gl-field' + (f.wide ? ' gl-field-wide' : ''));
        label.append(el('span', '', f.label));
        const input = el(f.type === 'select' ? 'select' : f.type === 'textarea' ? 'textarea' : 'input');
        if (f.type !== 'select' && f.type !== 'textarea') input.type = f.type;
        if (f.options) f.options.forEach(([value, text]) => {
          const opt = el('option', '', text);
          opt.value = value;
          input.append(opt);
        });
        input.name = f.key;
        input.id = this.id + '-' + tool.id + '-' + f.key;
        input.value = values[f.key];
        input.required = f.required;
        if (f.min != null) input.min = f.min;
        if (f.max != null) input.max = f.max;
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.file) {
          input.setAttribute('list', this.choices.id);
          input.autocomplete = 'off';
          input.spellcheck = false;
        }
        const updateValue = () => {
          const previousSuggestion = this.suggestedOutput(tool, values);
          const useSuggestion = f.key !== 'out' && previousSuggestion && values.out === previousSuggestion;
          values[f.key] = input.value;
          const nextSuggestion = useSuggestion && this.suggestedOutput(tool, values);
          if (nextSuggestion) {
            values.out = nextSuggestion;
            const outputInput = form.elements.namedItem('out');
            if (outputInput) outputInput.value = values.out;
          }
          this.updateCommand();
        };
        input.addEventListener('input', updateValue);
        input.addEventListener('change', updateValue);
        label.append(input);
        grid.append(label);
      });
      const block = el('div', 'gl-command-block');
      const top = el('div', 'gl-command-top');
      const copy = el('button', 'gl-small-button', 'Copy command');
      copy.type = 'button';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(this.commandPreview.textContent);
          this.status.textContent = 'Command copied.';
        } catch (_) {
          this.status.textContent = 'Select the command text to copy it.';
        }
      });
      top.append(el('span', '', 'Command'), copy);
      this.commandPreview = el('pre', 'gl-command');
      block.append(top, this.commandPreview);
      const row = el('div', 'gl-run-row');
      const submit = el('button', 'gl-run', 'Run tool');
      submit.type = 'submit';
      this.status = el('span', 'gl-status');
      this.status.setAttribute('role', 'status');
      row.append(submit, this.status);
      form.append(grid, el('p', 'gl-hint', 'Use a different output filename for each run to keep earlier results.'), block, row, el('p', 'gl-hint', 'Tools run in your browser.'));
      form.addEventListener('submit', event => {
        event.preventDefault();
        if (form.reportValidity()) this.submit(tool, Object.assign({}, values));
      });
      this.formRegion.append(form);
      this.updateCommand();
      this.renderDetail();
    }

    updateCommand() {
      const tool = TOOLS.find(t => t.id === this.toolId);
      this.commandPreview.textContent = tool.command(this.toolValues(tool));
    }

    refresh() {
      const files = Array.from(this.fs.entries || []).filter(([, entry]) => entry.kind !== 'dir').sort(([a], [b]) => a.localeCompare(b));
      this.choices.replaceChildren();
      files.forEach(([name]) => {
        const option = el('option');
        option.value = name;
        this.choices.append(option);
      });
      // Bowtie2 takes a shared prefix, rather than one of the index files.
      const prefixes = new Set(files.filter(([name]) => /\.1\.bt2l?$/.test(name)).map(([name]) => name.replace(/\.1\.bt2l?$/, '')));
      prefixes.forEach(name => {
        const option = el('option', '', 'Bowtie2 index prefix');
        option.value = name;
        this.choices.append(option);
      });
      this.fileSummary.textContent = 'Files (' + files.length + ')';
      this.fileItems.replaceChildren();
      files.forEach(([name, entry]) => {
        const display = name.startsWith('/home/student/') ? name.slice('/home/student/'.length) : name;
        const button = el('button', 'gl-file', display);
        button.type = 'button';
        button.title = name + (typeof this.fs.size === 'function' ? ' · ' + this.fs.size(entry) + ' bytes' : '');
        button.addEventListener('click', () => this.openFile(name));
        this.fileItems.append(button);
      });
      this.renderHistory();
    }

    async openFile(name) {
      if (this.onSelectFile) {
        try { await this.onSelectFile(name); }
        catch (error) { this.status.textContent = 'Could not inspect file: ' + (error.message || String(error)); }
        return;
      }
      try {
        await navigator.clipboard.writeText(name);
        this.status.textContent = 'File path copied. Paste it into the input you want to change.';
      } catch (_) {
        this.status.textContent = 'File path: ' + name;
      }
    }

    async submit(tool, values) {
      const command = tool.command(values);
      if (!command.trim()) return;
      const job = { id: this.jobs.length + 1, toolId: tool.id, title: tool.title, values, command, dataset: this.datasetId, status: 'queued', submitted: new Date(), outputs: [], code: null, log: '' };
      this.jobs.push(job);
      this.selectedJob = job;
      this.status.textContent = 'Job ' + job.id + ' queued.';
      this.renderHistory();
      this.renderDetail();
      let before = null, hasCapturedOutputs = false;
      const onStart = () => {
        if (job.started != null) return;
        job.status = 'running';
        job.started = Date.now();
        before = new Map(Array.from(this.fs.entries || []).map(([p, e]) => [p, { entry: e, mtime: e.mtime, size: e.size }]));
        this.renderHistory();
        this.renderDetail();
      };
      try {
        // Submit immediately: the root runner owns the one shared execution queue.
        // onStart marks execution (and the snapshot) only after earlier jobs finish.
        const result = await this.run(command, { source: 'galaxy', tool: tool.id, title: tool.title, dataset: job.dataset, jobId: job.id, onStart });
        job.code = typeof result === 'number' ? result : result && Number.isFinite(result.code) ? result.code : 1;
        job.status = job.code === 0 ? 'success' : 'error';
        if (result && typeof result === 'object') {
          job.log = [result.stdout, result.stderr, result.error && String(result.error)].filter(v => typeof v === 'string' && v.length).join('\n');
          if (typeof result.output === 'string' && !job.log) job.log = result.output;
          if (Array.isArray(result.created)) {
            job.outputs = Array.from(new Set(result.created.filter(p => typeof p === 'string')));
            hasCapturedOutputs = true;
          }
        }
        if (!result && result !== 0) job.log = 'The runner returned no exit status. Inspect the terminal log.';
      } catch (error) {
        job.code = 1;
        job.status = 'error';
        job.log = error.message || String(error);
      } finally {
        if (job.started != null) job.elapsed = (Date.now() - job.started) / 1000;
        if (!hasCapturedOutputs && before) {
          job.outputs = Array.from(this.fs.entries || []).filter(([p, e]) => {
            if (e.kind === 'dir') return false;
            const prior = before.get(p);
            return !prior || prior.entry !== e || prior.mtime !== e.mtime || prior.size !== e.size;
          }).map(([p]) => p);
        }
        this.refresh();
        this.renderDetail();
        if (this.status) this.status.textContent = 'Job ' + job.id + (job.status === 'success' ? ' completed.' : ' failed (exit ' + job.code + ').');
      }
      return job;
    }

    renderHistory() {
      this.historyTitle.textContent = 'History · ' + this.jobs.length + ' jobs';
      this.historyJobs.replaceChildren();
      if (!this.jobs.length) this.historyJobs.append(el('p', 'gl-empty', 'Choose a tool, check its inputs and run it. Jobs will appear here.'));
      this.jobs.slice().reverse().forEach(job => {
        const button = el('button', 'gl-job');
        button.type = 'button';
        button.dataset.status = job.status;
        button.setAttribute('aria-pressed', String(this.selectedJob === job));
        const state = { success: 'Completed', error: 'Failed', queued: 'Queued', running: 'Running' }[job.status];
        button.append(el('strong', '', job.id + '. ' + job.title), el('small', '', state + ' · ' + job.dataset + (job.elapsed != null ? ' · ' + job.elapsed.toFixed(1) + 's' : '')));
        if (job.outputs.length) button.append(el('small', '', job.outputs.length + ' new or changed file' + (job.outputs.length === 1 ? '' : 's')));
        button.addEventListener('click', () => {
          this.selectedJob = job;
          this.renderHistory();
          this.renderDetail();
          this.detailRegion.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
        this.historyJobs.append(button);
      });
    }

    renderDetail() {
      this.detailRegion.replaceChildren();
      const job = this.selectedJob;
      if (!job) return;
      const detail = el('section', 'gl-job-detail');
      detail.append(el('h3', '', 'Job ' + job.id + ' · ' + job.title));
      const state = job.status === 'success' ? 'Completed · exit 0' : job.status === 'error' ? 'Failed · exit ' + job.code : job.status === 'running' ? 'Running' : 'Queued';
      detail.append(el('p', 'gl-hint' + (job.status === 'error' ? ' gl-error' : ''), state + ' · ' + job.submitted.toLocaleString() + (job.elapsed != null ? ' · ' + job.elapsed.toFixed(2) + ' seconds' : '')));
      detail.append(el('pre', 'gl-command', job.command));
      const reuse = el('button', 'gl-small-button', 'Load these settings');
      reuse.type = 'button';
      reuse.addEventListener('click', () => {
        this.values[job.toolId] = Object.assign({}, job.values);
        this.selectTool(job.toolId);
        this.formRegion.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        this.status.textContent = 'Settings loaded. Change the output filename to keep the earlier result.';
      });
      detail.append(reuse);
      if (job.outputs.length) {
        detail.append(el('p', 'gl-hint', job.status === 'error' ? 'Files created or changed before the failure (may be incomplete):' : 'New or changed files:'));
        job.outputs.forEach(name => {
          const button = el('button', 'gl-file', name);
          button.type = 'button';
          button.addEventListener('click', () => this.openFile(name));
          detail.append(button);
        });
      } else if (job.status === 'success') detail.append(el('p', 'gl-hint', 'No files were created or changed. Check the terminal for output.'));
      if (job.log) detail.append(el('pre', 'gl-log' + (job.status === 'error' ? ' gl-error' : ''), job.log.slice(0, 20000) + (job.log.length > 20000 ? '\n… Log truncated; see the terminal for full output.' : '')));
      if (job.status === 'error' && !job.log) detail.append(el('p', 'gl-hint gl-error', 'Check the error in the terminal, including file paths, formats and required indexes.'));
      this.detailRegion.append(detail);
    }
  }

  LabGalaxy.TOOLS = TOOLS;
  LabGalaxy.quote = quote;
  window.LabGalaxy = LabGalaxy;
})();
