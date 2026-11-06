#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {loadJob,read,write,run,probe,local} from './lib/media.mjs';
import {prepare,render} from './lib/render.mjs';
import {projects,defaults,inspectProject,stage,apply,restore,verifyDraft} from './lib/native.mjs';

function options(args){const o={};for(let i=0;i<args.length;i+=2){if(!['--job','--project','--drafts','--file','--out','--count'].includes(args[i])||args[i+1]===undefined||o[args[i]]!==undefined)throw new Error('Некорректный параметр '+args[i]);o[args[i]]=args[i+1];}return o;}
function doctor(){
  const checks=[];for(const tool of ['node','ffmpeg','ffprobe'])try{checks.push({tool,ok:true,version:run(tool,tool==='node'?['--version']:['-version'],{timeout:10000}).split(/\r?\n/)[0]});}catch(e){checks.push({tool,ok:false,error:e.message});}
  const drafts=defaults();let count=null;try{count=projects(drafts).length;}catch{}
  return {mode:'capcut-desktop',checks,drafts,projects:count,capcut_web_mcp_required:false,asr:'Проверяется отдельно: transcribe.py --help. Автоматических загрузок моделей нет.',native_export:'Через настольное приложение; render создаёт отдельный локальный MP4.'};
}
function initPlan(dir){
  const file=path.join(dir,'edit-plan.json'),job=read(path.join(dir,'job.json'));if(job.mode!=='capcut-desktop')throw new Error('Нужна desktop-папка работы');
  if(fs.existsSync(file))throw new Error('План уже существует; сохранённые решения не заменены');
  write(file,{version:1,cuts:[],overlays:[],audio:[],captions:[],caption_style:{size_px:64,color:'#FFFFFF',outline_color:'#161616',outline_px:3},note:'Заполнить после полного анализа. Сумма frames в cuts = duration_s × fps. Схема: references/desktop-plan.md.'});return {plan:file,status:'empty_template'};
}
function sheet(o){
  const file=local(o['--file']),p=probe(file),out=path.resolve(o['--out']??''),count=Number(o['--count']??30);
  if(!o['--out']||!out.endsWith('.jpg')||!Number.isInteger(count)||count<1||count>120||!p.video||!Number.isFinite(p.duration))throw new Error('sheet: --file VIDEO --out NEW.jpg [--count 1..120]');
  fs.mkdirSync(path.dirname(out),{recursive:true});
  const step=p.duration/count;
  run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n','-filter_threads','1','-i',file,'-vf',`fps=1/${step},scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2,tile=5x${Math.ceil(count/5)}`,'-frames:v','1','-q:v','2',out]);
  write(out+'.json',{source:file,interval_s:step,sample_count:count,first_sample_approximately_s:step/2,note:'Обзор всей длительности; точные события проверять отдельными кадрами и звуком.'});return {file:out};
}
try{
  const [cmd,...args]=process.argv.slice(2),o=options(args);let result;
  if(!cmd||cmd==='help')result={commands:['doctor','projects [--drafts DIR]','inspect-project --project DIR','init-plan --job DIR','validate --job DIR','prepare --job DIR','render --job DIR','stage --job DIR --project DIR','apply --job DIR --project DIR','check --project DIR','restore --job DIR','sheet --file VIDEO --out NEW.jpg [--count 30]']};
  else if(cmd==='doctor')result=doctor();
  else if(cmd==='projects')result=projects(o['--drafts']);
  else if(cmd==='inspect-project'){const p=inspectProject(o['--project']);result={project:p.root,name:p.name,empty:p.empty,schema:p.j.new_version,canvas:p.j.canvas_config,copies:p.files.length};}
  else if(cmd==='init-plan')result=initPlan(o['--job']);
  else if(cmd==='validate'){const v=loadJob(o['--job']);result={valid:true,frames:v.frames,cuts:v.cuts.length,overlays:v.overlays.length,captions:v.captions.length,target:v.target};}
  else if(cmd==='prepare')result=prepare(o['--job']);
  else if(cmd==='render')result=render(o['--job']);
  else if(cmd==='stage')result=stage(o['--job'],o['--project']);
  else if(cmd==='apply')result=apply(o['--job'],o['--project']);
  else if(cmd==='restore')result=restore(o['--job']);
  else if(cmd==='check')result=verifyDraft(inspectProject(o['--project']).j);
  else if(cmd==='sheet')result=sheet(o);
  else throw new Error('Неизвестная команда '+cmd);
  console.log(JSON.stringify(result,null,2));if(cmd==='doctor'&&result.checks.some(c=>!c.ok))process.exitCode=1;
}catch(e){console.error(JSON.stringify({error:e.message}));process.exitCode=1;}
