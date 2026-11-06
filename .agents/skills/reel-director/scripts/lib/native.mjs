// Adapter derived from the supplied author's assets/capcut templates and desktop writer.
// Does not import the author's machine.json, cached effects, login code or paid clients.
import fs from 'node:fs';
import path from 'node:path';
import {SOURCE,read,write,hash,id,run,loadJob,locked,inside} from './media.mjs';
import {prepared,captions} from './render.mjs';

const tpl=name=>read(path.join(SOURCE,'assets/capcut',name+'.json'));
const us=(f,fps)=>Math.round(f*1e6/fps);
const slash=p=>p.replaceAll('\\','/');
export const defaults=()=>path.join(process.env.LOCALAPPDATA??'', 'CapCut/User Data/Projects/com.lveditor.draft');
export function projects(drafts=defaults()){
  const index=path.join(drafts,'root_meta_info.json');
  return (read(index).all_draft_store??[]).map(e=>({name:e.draft_name,path:e.draft_fold_path,duration_s:e.tm_duration/1e6}));
}
export function inspectProject(folder){
  const root=fs.realpathSync(folder),content=path.join(root,'draft_content.json');
  let j;try{j=read(content);}catch{throw new Error('Нет читаемого draft_content.json. Зашифрованные/другие форматы не изменяются.');}
  if(!/^[a-zA-Z0-9-]{8,80}$/.test(j.id??''))throw new Error('Неизвестный ID проекта.');
  if(j.version!==360000||!['185.0.0','189.0.0','191.0.0'].includes(j.new_version)||!Array.isArray(j.tracks)||!j.materials||!j.canvas_config)throw new Error(`Непроверенная схема CapCut: ${j.version}/${j.new_version}. Нужен аудит нового формата, не обход проверки.`);
  const files=[content];
  const timeline=path.join(root,'Timelines',j.id,'draft_content.json');if(fs.existsSync(timeline))files.push(timeline);
  for(const f of [...files]){const tmp=path.join(path.dirname(f),'template-2.tmp');if(fs.existsSync(tmp))files.push(tmp);}
  for(const f of files){inside(root,fs.realpathSync(f));if(JSON.stringify(read(f))!==JSON.stringify(j))throw new Error(`Копии таймлайна различаются: ${f}. Закройте CapCut и проверьте сохранение.`);}
  const meta=path.join(root,'draft_meta_info.json');read(meta);inside(root,fs.realpathSync(meta));
  return {root,content,files,meta,j,name:read(meta).draft_name??path.basename(root),empty:!j.tracks.some(t=>t.segments?.length)};
}
export function requireClosed(){
  if(process.platform!=='win32')throw new Error('Этот адаптер проверяется на Windows.');
  const csv=run('tasklist.exe',['/FO','CSV','/NH'],{timeout:15000});
  if(/^"CapCut\.exe"/im.test(csv))throw new Error('Сохраните работу и полностью закройте настольный CapCut перед записью. Программа не будет закрыта принудительно.');
}
function extras(M){
  const values={speeds:{type:'speed',mode:0,speed:1,curve_speed:null},placeholder_infos:{type:'placeholder_info',meta_type:'none',res_path:'',res_text:'',error_path:'',error_text:''},audio_fades:{type:'audio_fade',fade_type:0,fade_in_duration:0,fade_out_duration:0},canvases:{type:'canvas_color',color:'',blur:0,image:'',album_image:'',image_id:'',image_name:'',source_platform:0,team_id:''},sound_channel_mappings:{type:'none',audio_channel_mapping:0,is_config_open:false},material_colors:{is_color_clip:false,is_gradient:false,solid_color:'',gradient_colors:[],gradient_percents:[],gradient_angle:90,width:0,height:0},vocal_separations:{type:'vocal_separation',choice:0,removed_sounds:[],time_range:null,production_path:'',final_algorithm:'',enter_from:''}};
  return Object.entries(values).map(([k,v])=>{v.id=id();(M[k]??=[]).push(v);return v.id;});
}
function segment(M,c,type,V){
  const fps=V.target.fps,range={start:us(c.at,fps),duration:us(c.at+c.frames,fps)-us(c.at,fps)},mid=id();
  if(type==='text'){
    const S={...V.style,...c.style},m=tpl('text-material'),rgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255),size=S.size_px*9/64;
    Object.assign(m,{id:mid,content:JSON.stringify({text:c.text,styles:[{fill:{alpha:1,content:{render_type:'solid',solid:{alpha:1,color:rgb(S.color)}}},font:{id:'',path:slash(S.font_file)},range:[0,[...c.text].length],size,strokes:S.outline_px?[{alpha:1,content:{render_type:'solid',solid:{alpha:1,color:rgb(S.outline_color)}},width:S.outline_px*.02}]:[],useLetterColor:true}]}),font_path:slash(S.font_file),font_size:size,text_size:S.size_px,text_color:S.color,border_color:S.outline_color,border_width:S.outline_px*.02,alignment:1,has_shadow:false,words:{start_time:[],end_time:[],text:[]}});delete m.base_content;
    (M.texts??=[]).push(m);const s=tpl('text-segment');
    return {...s,id:id(),material_id:mid,extra_material_refs:[],source_timerange:null,target_timerange:range,common_keyframes:[],clip:{...s.clip,scale:{x:1,y:1},transform:{x:2*S.x/V.target.width-1,y:1-2*S.y/V.target.height}},render_index:14000,track_render_index:3};
  }
  const audio=type==='audio',m=tpl(audio?'audio-material':'video-material');
  Object.assign(m,{id:mid,path:slash(c.file),duration:us(c.frames,fps),type:audio?'extract_music':'video'});
  if(audio)Object.assign(m,{name:path.basename(c.file),music_id:'',category_name:'',text_id:'',effect_id:'',resource_id:''});
  else Object.assign(m,{unique_id:id().replaceAll('-',''),width:V.target.width,height:V.target.height,has_audio:type==='head',material_name:path.basename(c.file),crop:{upper_left_x:0,upper_left_y:0,upper_right_x:1,upper_right_y:0,lower_left_x:0,lower_left_y:1,lower_right_x:1,lower_right_y:1},crop_ratio:'free',crop_scale:1});
  (M[audio?'audios':'videos']??=[]).push(m);
  const s=tpl(audio?'audio-segment':'video-segment');
  const kf=[];if(type==='head'&&c.zoom.some(z=>z!==1)){
    const [ax,ay]=c.zoom_anchor;
    for(const [prop,values] of Object.entries({KFTypeScaleX:c.zoom,KFTypeScaleY:c.zoom,KFTypePositionX:c.zoom.map(z=>(1-z)*(ax-.5)*2),KFTypePositionY:c.zoom.map(z=>(z-1)*(ay-.5)*2)}))
      kf.push({id:id(),material_id:'',property_type:prop,keyframe_list:values.map((v,i)=>({id:id(),curveType:'Line',time_offset:i?us(c.frames-1,fps):0,left_control:{x:0,y:0},right_control:{x:0,y:0},values:[v],string_value:'',graphID:''}))});
  }
  return {...s,id:id(),material_id:mid,extra_material_refs:extras(M),source_timerange:{start:0,duration:range.duration},target_timerange:range,speed:1,volume:type==='overlay'?0:1,last_nonzero_volume:1,common_keyframes:kf,keyframe_refs:[],render_index:type==='head'?0:1,track_render_index:audio?0:1,clip:audio?null:{scale:{x:1,y:1},rotation:0,transform:{x:0,y:0},flip:{vertical:false,horizontal:false},alpha:1}};
}
export function compile(P,V,p){
  const j=structuredClone(P.j);for(const [k,v] of Object.entries(j.materials))if(Array.isArray(v))j.materials[k]=[];
  const track=(name,type,flag,segments)=>({id:id(),name,type,flag,attribute:0,is_default_name:false,segments});
  j.tracks=[track('Codex · исходник','video',0,p.cuts.map(c=>segment(j.materials,c,'head',V)))];
  // Consecutive non-overlapping scene overlays can share one editable video track.
  // Keep the original stacking rule whenever any overlays overlap in time.
  const ordered=[...p.overlays].sort((a,b)=>a.at-b.at);
  const disjoint=ordered.every((c,i)=>!i||ordered[i-1].at+ordered[i-1].frames<=c.at);
  if(ordered.length&&disjoint)j.tracks.push(track('Codex · графика','video',1,ordered.map(c=>segment(j.materials,c,'overlay',V))));
  else for(const [i,c] of p.overlays.entries())j.tracks.push(track(`Codex · графика ${i+1}`,'video',1,[segment(j.materials,c,'overlay',V)]));
  if(V.captions.length)j.tracks.push(track('Codex · субтитры','text',0,V.captions.map(c=>segment(j.materials,c,'text',V))));
  for(const [i,c] of p.audio.entries())j.tracks.push(track(`Codex · звук ${i+1}`,'audio',0,[segment(j.materials,c,'audio',V)]));
  j.duration=us(V.frames,V.target.fps);j.fps=V.target.fps;j.canvas_config={...j.canvas_config,width:V.target.width,height:V.target.height,ratio:'9:16'};
  // Timings use differences of rounded frame boundaries: no cumulative rounding gaps.
  verifyDraft(j);return j;
}
export function verifyDraft(j){
  const materials=Object.values(j.materials).filter(Array.isArray).flat(),ids=new Set();
  for(const m of materials){if(ids.has(m.id))throw new Error('Дублированный ID материала');ids.add(m.id);}
  const head=j.tracks.find(t=>t.type==='video'&&t.flag===0);let end=0;
  for(const s of head?.segments??[]){if(s.target_timerange.start!==end)throw new Error('Разрыв главной дорожки');end+=s.target_timerange.duration;}
  if(end!==j.duration)throw new Error('Длительность главной дорожки отличается от проекта');
  for(const t of j.tracks)for(const s of t.segments??[]){
    for(const ref of [s.material_id,...(s.extra_material_refs??[])])if(!ids.has(ref))throw new Error('Отсутствует материал '+ref);
    if(s.target_timerange.start<0||s.target_timerange.duration<=0||s.target_timerange.start+s.target_timerange.duration>j.duration)throw new Error('Некорректный интервал сегмента');
    const m=materials.find(m=>m.id===s.material_id);if(m.path&&!fs.existsSync(m.path))throw new Error('Нет файла '+m.path);
  }
  return {ok:true,tracks:j.tracks.length,duration_s:j.duration/1e6,canvas:j.canvas_config};
}
export function stage(dir,folder){
  return locked(dir,()=>{
    const V=loadJob(dir),p=prepared(V),P=inspectProject(folder),statePath=path.join(V.root,'native-state.json');
    if(!P.empty){
      const state=fs.existsSync(statePath)?read(statePath):null;
      if(state?.project!==P.root||!state.written_files||state.written_files.filter(f=>path.dirname(f.path)!==path.dirname(P.root)).some(f=>!fs.existsSync(f.path)||hash(f.path)!==f.hash))throw new Error('Проект содержит чужой или изменённый монтаж. Используйте новый пустой проект; изменения вручную не перезаписываются.');
    }
    const j=compile(P,V,p),meta=read(P.meta),now=Date.now()*1000;
    meta.tm_duration=j.duration;meta.tm_draft_modified=now;meta.draft_fold_path=slash(P.root);
    const slot=(meta.draft_materials??=[]).find(s=>s.type===0)??{type:0,value:[]};if(!meta.draft_materials.includes(slot))meta.draft_materials.push(slot);
    const old=fs.existsSync(statePath)?read(statePath):null,ours=new Set(old?.media_files??[]);
    slot.value=(slot.value??[]).filter(x=>!ours.has(x.file_Path));
    for(const c of [...p.cuts,...p.overlays,...p.audio])slot.value.push({id:id(),file_Path:slash(c.file),extra_info:path.basename(c.file),duration:us(c.frames,V.target.fps),width:V.target.width,height:V.target.height,metetype:c.file.endsWith('.wav')?'music':'video',type:0,import_time:Math.floor(now/1e6),import_time_ms:now,create_time:Math.floor(now/1e6),item_source:1,roughcut_time_range:{start:0,duration:us(c.frames,V.target.fps)},sub_time_range:{start:-1,duration:-1}});
    const files=[...P.files.map(f=>({path:f,before:hash(f),text:JSON.stringify(j)})),{path:P.meta,before:hash(P.meta),text:JSON.stringify(meta)}];
    const index=path.join(path.dirname(P.root),'root_meta_info.json');
    if(fs.existsSync(index)){
      // Cloud IDs can exceed Number.MAX_SAFE_INTEGER. Preserve their exact JSON
      // numeric tokens while updating this project's safe timestamp/duration fields.
      const root=JSON.parse(fs.readFileSync(index,'utf8').replace(/^\uFEFF/,''),(k,v,c)=>typeof v==='number'&&Number.isInteger(v)&&!Number.isSafeInteger(v)?JSON.rawJSON(c.source):v),matches=(root.all_draft_store??[]).filter(e=>path.resolve(e.draft_fold_path).toLowerCase()===P.root.toLowerCase());
      if(matches.length!==1)throw new Error('Неоднозначная запись в индексе проектов');matches[0].tm_duration=j.duration;matches[0].tm_draft_modified=now;
      files.push({path:fs.realpathSync(index),before:hash(index),text:JSON.stringify(root)});
    }
    const result={project:P.root,project_name:P.name,plan_hash:V.plan_hash,job_hash:V.job_hash,created_at:new Date().toISOString(),files,media_files:[...p.cuts,...p.overlays,...p.audio].map(c=>slash(c.file))};
    write(path.join(V.root,'native-stage.json'),result);captions(V,V.root);
    return {status:'staged_only',project:P.root,files:files.length,check:verifyDraft(j)};
  });
}
function atomic(file,data){const temp=file+'.codex-'+id()+'.tmp';try{fs.writeFileSync(temp,data);fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}}
export function commit(files,backup,processCheck=requireClosed){
  processCheck();
  for(const f of files)if(hash(f.path)!==f.before)throw new Error(`Проект/индекс изменился после stage: ${f.path}`);
  fs.mkdirSync(backup,{recursive:true});
  const saved=files.map((f,i)=>{const copy=path.join(backup,`${i}.bak`);fs.copyFileSync(f.path,copy);return {path:f.path,backup:copy,before:f.before,after:hashBuffer(f.text)};});
  write(path.join(backup,'transaction.json'),{status:'prepared',files:saved});
  const changed=[];
  try{
    processCheck();
    for(const [i,f] of files.entries()){
      if(hash(f.path)!==f.before)throw new Error('Файл изменился во время записи: '+f.path);
      atomic(f.path,f.text);changed.push(i);
    }
    write(path.join(backup,'transaction.json'),{status:'committed',files:saved});
  }catch(e){
    const conflicts=[];
    for(const i of changed.reverse()){const f=saved[i];if(hash(f.path)===f.after)atomic(f.path,fs.readFileSync(f.backup));else conflicts.push(f.path);}
    write(path.join(backup,'transaction.json'),{status:conflicts.length?'rollback_conflict':'rolled_back',files:saved,conflicts});throw e;
  }
  return saved;
}
import crypto from 'node:crypto';
const hashBuffer=s=>crypto.createHash('sha256').update(s).digest('hex');
export function apply(dir,folder){
  return locked(dir,()=>{
    const V=loadJob(dir);prepared(V);const s=read(path.join(V.root,'native-stage.json')),P=inspectProject(folder);
    if(s.project!==P.root||s.plan_hash!==V.plan_hash||s.job_hash!==V.job_hash)throw new Error('Проект или план отличается от stage.');
    const allowed=new Set([...P.files,P.meta]);const index=path.join(path.dirname(P.root),'root_meta_info.json');if(fs.existsSync(index))allowed.add(fs.realpathSync(index));
    if(s.files.some(f=>!allowed.has(f.path))||new Set(s.files.map(f=>f.path)).size!==s.files.length||[...allowed].some(f=>!s.files.some(x=>x.path===f)))throw new Error('Состав файлов stage не соответствует выбранному проекту.');
    for(const f of s.files.filter(f=>P.files.includes(f.path)))verifyDraft(JSON.parse(f.text));
    const backup=path.join(V.root,'backups',id());
    requireClosed();const written=locked(P.root,()=>commit(s.files,backup));
    write(path.join(V.root,'native-state.json'),{project:P.root,name:s.project_name,backup,plan_hash:V.plan_hash,written_files:written.map(f=>({path:f.path,hash:f.after})),media_files:s.media_files,status:'written_requires_app_review'});
    return {status:'written_requires_app_review',project:P.root,backup,check:verifyDraft(inspectProject(P.root).j),native_export:false};
  });
}
export function restore(dir){
  return locked(dir,()=>{
    const root=fs.realpathSync(dir),state=read(path.join(root,'native-state.json'));
    const backup=inside(root,state.backup),txn=read(path.join(backup,'transaction.json'));
    if(txn.status!=='committed'||state.status==='restored')throw new Error('Нет активной завершённой записи для отката.');
    const P=inspectProject(state.project),allowed=new Set([...P.files,P.meta,path.join(path.dirname(P.root),'root_meta_info.json')].map(f=>path.resolve(f)));
    const files=txn.files.map(f=>{if(!allowed.has(path.resolve(f.path)))throw new Error('Посторонний путь отката');inside(backup,f.backup);if(hash(f.backup)!==f.before)throw new Error('Повреждена резервная копия');return {path:f.path,before:f.after,text:fs.readFileSync(f.backup)};});
    const log=path.join(root,'backups','restore-'+id());requireClosed();locked(P.root,()=>commit(files,log));write(path.join(root,'native-state.json'),{...state,status:'restored',restore_log:log});
    return {status:'restored',project:state.project};
  });
}
