// Offline synthetic tests. No writes to real CapCut projects, network or paid operations.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {KIT,SOURCE,loadJob,write,read,hash,geometry,id} from '../.agents/skills/reel-director/scripts/lib/media.mjs';
import {prepare,render,prepared} from '../.agents/skills/reel-director/scripts/lib/render.mjs';
import {stage,inspectProject,verifyDraft,commit,compile} from '../.agents/skills/reel-director/scripts/lib/native.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'codex-desktop-test-')),checks=[];
function cmd(exe,args){const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:8e6});if(r.error)throw r.error;return r;}
function ok(r){assert.equal(r.status,0,r.stderr||r.stdout);return r;}
const ff=args=>ok(cmd('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n','-filter_threads','1',...args]));
const scripts=path.join(KIT,'.agents/skills/reel-director/scripts'),cli=(name,...args)=>cmd(process.execPath,[path.join(scripts,name),...args]);
const passed=s=>{checks.push(s);console.log('PASS '+s);};
try{
  const src=path.join(root,'говорящий & тест.mp4'),ref=path.join(root,'reference.mp4');
  ff(['-f','lavfi','-i','testsrc2=size=1920x1080:rate=30:duration=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1','-t','1','-c:v','libx264','-preset','ultrafast','-crf','23','-c:a','aac',src]);
  ff(['-f','lavfi','-i','color=c=white:size=1080x1920:rate=30:duration=1','-an','-c:v','libx264','-preset','ultrafast',ref]);
  const init=['init','--source',src,'--reference',ref,'--root',root,'--duration','1','--fps','30'];
  const job=JSON.parse(ok(cli('reel.mjs',...init)).stdout).work_directory,second=JSON.parse(ok(cli('reel.mjs',...init)).stdout).work_directory;
  assert.notEqual(job,second);assert.equal(read(path.join(job,'job.json')).mode,'capcut-desktop');
  assert.notEqual(cli('reel.mjs','init','--source',src,'--reference',src,'--root',root).status,0);
  passed('Desktop jobs, Unicode paths and preservation of existing work');
  const overlay=path.join(root,'card.png');ff(['-f','lavfi','-i','color=c=yellow:size=400x200','-frames:v','1',overlay]);
  const plan={version:1,cuts:[{file:src,source_start_s:0,frames:15,fit:'contain',zoom:[1,1.08]},{file:src,source_start_s:.5,frames:15,fit:'cover',focus:[.8,.5]}],overlays:[{file:overlay,at:4,frames:20,rect:[100,300,400,200],fade_s:.1}],audio:[{file:src,at:0,frames:3,gain_db:-20}],captions:[{at:3,frames:23,text:'Проверка: текст!'}]};
  plan.captions=[{at:3,frames:10,text:'Проверка: верх!',style:{x:500,y:450,size_px:52}},{at:13,frames:13,text:'Проверка: низ!',style:{x:540,y:1500,size_px:62}}];
  plan.overlays.push({file:overlay,at:29,frames:1,rect:[100,300,400,200]});
  write(path.join(job,'edit-plan.json'),plan);assert.equal(loadJob(job).frames,30);assert.throws(()=>geometry(1080,1920,'stretch'));
  for(const change of [p=>p.cuts[0].frames=14,p=>p.cuts[0].source_start_s=1,p=>p.cuts[0].speed=2,p=>p.overlays[0].rect=[1000,0,400,200],p=>p.captions.push({at:5,frames:2,text:'наложение'})]){
    const bad=structuredClone(plan);change(bad);write(path.join(job,'edit-plan.json'),bad);assert.throws(()=>loadJob(job));
  }
  for(const change of [p=>p.captions[0].style.y=1921,p=>p.captions[0].style.size_px=200,p=>p.captions[0].style.fade=1]){const bad=structuredClone(plan);change(bad);write(path.join(job,'edit-plan.json'),bad);assert.throws(()=>loadJob(job));}
  write(path.join(job,'edit-plan.json'),plan);passed('Rejects wrong duration, source overflow, off-canvas layers, invalid caption styles and overlapping captions');
  prepare(job);const V=loadJob(job),p=prepared(V);
  for(const c of [...p.cuts,...p.overlays]){const r=JSON.parse(ok(cli('reel.mjs','inspect',c.file)).stdout);assert.equal(r.video.width,1080);assert.equal(r.video.height,1920);}
  const alpha=path.join(root,'alpha.gray');ff(['-i',p.overlays[0].file,'-vf','alphaextract,crop=16:16:0:0','-frames:v','1','-pix_fmt','gray','-f','rawvideo',alpha]);assert.ok([...fs.readFileSync(alpha)].every(x=>x<=2));
  passed('Portrait contain/cover preparation and true transparent ProRes overlay');
  const movie=render(job);ok(cli('reel.mjs','verify',movie.file,'--duration','1','--fps','30'));assert.equal(movie.native_capcut_export,false);
  const last=path.join(root,'last-frame.rgb');ff(['-i',movie.file,'-vf','select=eq(n\\,29),crop=200:100:150:350','-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',last]);
  const px=fs.readFileSync(last);assert.equal(px.length,200*100*3);for(let i=0;i<px.length;i+=3){assert.ok(px[i]>225);assert.ok(px[i+1]>225);assert.ok(px[i+2]<35);}
  passed('Frame-accurate overlay clock retains a one-frame overlay on the final frame');
  const preview=path.join(KIT,'.validation/desktop-preview.jpg');fs.mkdirSync(path.dirname(preview),{recursive:true});ok(cmd('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss','0.4','-i',movie.file,'-frames:v','1',preview]));
  passed('1080×1920 MP4 with two cuts, zoom, alpha, Russian text and audio mix');
  const project=path.join(root,'CapCut synthetic'),pid=id();fs.mkdirSync(path.join(project,'Timelines',pid),{recursive:true});
  const skeleton={id:pid,version:360000,new_version:'191.0.0',fps:30,duration:0,canvas_config:{width:1920,height:1080,ratio:'original'},materials:{videos:[],audios:[],texts:[]},tracks:[]};
  for(const f of ['draft_content.json','template-2.tmp',`Timelines/${pid}/draft_content.json`,`Timelines/${pid}/template-2.tmp`])write(path.join(project,f),skeleton);
  write(path.join(project,'draft_meta_info.json'),{draft_name:'Synthetic only',draft_materials:[]});
  const indexFile=path.join(root,'root_meta_info.json');
  fs.writeFileSync(indexFile,`{"all_draft_store":[{"draft_name":"Synthetic only","draft_fold_path":${JSON.stringify(project)},"tm_duration":0},{"draft_name":"Unrelated synthetic","draft_fold_path":${JSON.stringify(path.join(root,'other'))},"tm_draft_cloud_entry_id":7591576779509203473}]}`);
  const before=hash(path.join(project,'draft_content.json'));stage(job,project);assert.equal(hash(path.join(project,'draft_content.json')),before);
  const s=read(path.join(job,'native-stage.json')),draft=JSON.parse(s.files[0].text);assert.ok(s.files.find(f=>f.path===indexFile).text.includes('"tm_draft_cloud_entry_id":7591576779509203473'));passed('Unrelated project cloud IDs retain exact 64-bit JSON tokens');verifyDraft(draft);assert.equal(draft.canvas_config.width,1080);assert.equal(draft.canvas_config.height,1920);
  assert.equal(draft.tracks[0].segments[1].target_timerange.start,500000);assert.equal(draft.tracks[0].segments[0].common_keyframes.length,4);assert.ok(draft.materials.texts.every(m=>JSON.parse(m.content).text.includes(':')));
  const texts=draft.tracks.find(t=>t.type==='text').segments;
  assert.equal(texts[0].clip.transform.y,1-2*450/1920);assert.equal(texts[1].clip.transform.y,1-2*1500/1920);
  assert.equal(draft.materials.texts[0].text_size,52);assert.equal(draft.materials.texts[1].text_size,62);
  const ass=fs.readFileSync(path.join(path.dirname(movie.file),'captions.ass'),'utf8');assert.ok(ass.includes('\\pos(500,450)\\fs52'));assert.ok(ass.includes('\\pos(540,1500)\\fs62'));
  passed('Per-caption placement and size are validated and shared by ASS and native text');
  const isolated={...p,overlays:[{...p.overlays[0],at:0,frames:10},{...p.overlays[0],at:10,frames:10}]};
  const grouped=compile(inspectProject(project),V,isolated);assert.equal(grouped.tracks.filter(t=>t.type==='video'&&t.flag===1).length,1);assert.equal(grouped.tracks.find(t=>t.flag===1).segments.length,2);
  const overlapping=compile(inspectProject(project),V,{...isolated,overlays:isolated.overlays.map(c=>({...c,at:0}))});assert.equal(overlapping.tracks.filter(t=>t.type==='video'&&t.flag===1).length,2);
  passed('Sequential overlays share one track; overlapping layers preserve stacking');
  const applied=cli('desktop.mjs','apply','--job',job,'--project',project);
  if(applied.status===0){
    assert.equal(JSON.parse(applied.stdout).status,'written_requires_app_review');
    ok(cli('desktop.mjs','restore','--job',job));assert.equal(hash(path.join(project,'draft_content.json')),before);
    passed('CLI apply and restore operate correctly on an isolated synthetic project');
  }else{assert.match(applied.stderr,/закройте настольный CapCut/);assert.equal(hash(path.join(project,'draft_content.json')),before);passed('CLI refuses to write while CapCut is running');}
  commit(s.files,path.join(job,'backups/test'),()=>{});verifyDraft(inspectProject(project).j);assert.throws(()=>commit(s.files,path.join(job,'backups/stale'),()=>{}),/изменился/);
  passed('Native editable text/zoom, staging without writes, four synced copies, backups and stale-write rejection');
  const dirty=read(path.join(project,'draft_content.json'));dirty.duration=123;write(path.join(project,'draft_content.json'),dirty);assert.throws(()=>inspectProject(project),/различаются/);
  const a=path.join(root,'a.json'),b=path.join(root,'b.json');fs.writeFileSync(a,'before-a');fs.writeFileSync(b,'before-b');let calls=0;
  const files=[{path:a,before:hash(a),text:'after-a'},{path:b,before:hash(b),text:'after-b'}];
  assert.throws(()=>commit(files,path.join(root,'rollback'),()=>{if(++calls===2)fs.writeFileSync(b,'external edit');}),/изменился/);assert.equal(fs.readFileSync(a,'utf8'),'before-a');assert.equal(fs.readFileSync(b,'utf8'),'external edit');
  passed('Divergent copies rejected; partial write rollback preserves concurrent edits');
  for(const name of ['audio-material','audio-segment','text-material','text-segment','video-material','video-segment'])assert.ok(read(path.join(KIT,'assets/capcut',name+'.json')));
  passed('Six CapCut material templates are available and parse as JSON');
  const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(x=>x.isDirectory()?walk(path.join(d,x.name)):[path.join(d,x.name)]);
  const js=walk(path.join(KIT,'.agents')).filter(f=>f.endsWith('.mjs'));for(const f of js)ok(cmd(process.execPath,['--check',f]));passed(`Active JavaScript syntax: ${js.length} files`);
  const report={passed:true,checked_at:new Date().toISOString(),checks,test_artifacts:root,preview,not_tested:['Generated draft opening and export inside the actual CapCut app','Paid Higgsfield operations','ASR on real speech','Original horizontal scripts (reference only)']};write(path.join(KIT,'.validation/checks.json'),report);console.log(JSON.stringify(report,null,2));
}catch(e){console.error(e.stack);console.error('Test artifacts: '+root);process.exitCode=1;}
