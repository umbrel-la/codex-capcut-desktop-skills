import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const KIT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
export const SOURCE = KIT;
export const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
export function hash(file){const h=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));return h.digest('hex');}finally{fs.closeSync(fd);}}
export const id = () => crypto.randomUUID().toUpperCase();
export function write(file, value) {fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, JSON.stringify(value,null,2)+'\n');}
export function run(exe, args, opts={}) {
  const r=spawnSync(exe,args,{encoding:'utf8',windowsHide:true,timeout:3600000,maxBuffer:16*1024*1024,...opts});
  if(r.error || r.status!==0) throw new Error(`${exe}: ${r.error?.message || r.stderr?.slice(-3000) || r.status}`);
  return r.stdout;
}
export function inside(root, file) {
  const rel=path.relative(path.resolve(root),path.resolve(file));
  if(rel==='..' || rel.startsWith('..'+path.sep) || path.isAbsolute(rel)) throw new Error(`Путь вне рабочей папки: ${file}`);
  return path.resolve(file);
}
export function local(file, base=process.cwd()) {
  if(typeof file!=='string' || /^\w+:\/\//.test(file)) throw new Error('Нужен локальный путь.');
  const full=fs.realpathSync(path.resolve(base,file));
  if(!fs.statSync(full).isFile()) throw new Error(`Не файл: ${full}`);
  return full;
}
export const number=(x,label,min,max)=>{if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw new Error(`Некорректное ${label}: ${x}`);return x;};
export const integer=(x,label,min=0,max=1e8)=>{number(x,label,min,max);if(!Number.isInteger(x))throw new Error(`${label}: нужно целое число кадров`);return x;};
const keys=(obj,allowed,label)=>{for(const k of Object.keys(obj))if(!allowed.includes(k))throw new Error(`${label}: неподдерживаемое поле ${k}. Подготовьте эффект отдельным слоем или расширьте адаптер с проверкой.`);};
export function probe(file) {
  const j=JSON.parse(run('ffprobe',['-v','error','-show_format','-show_streams','-of','json',file]));
  const v=j.streams.find(x=>x.codec_type==='video'), a=j.streams.find(x=>x.codec_type==='audio');
  const rotation=Number(v?.side_data_list?.find(x=>x.rotation!==undefined)?.rotation ?? v?.tags?.rotate ?? 0);
  const swap=Math.abs(rotation%180)===90, [n,d=1]=String(v?.avg_frame_rate??'0').split('/').map(Number);
  return {width:swap?v?.height:v?.width,height:swap?v?.width:v?.height,rotation,fps:d?n/d:0,duration:Number(j.format.duration??v?.duration??a?.duration),video:!!v,audio:!!a,pixel_format:v?.pix_fmt};
}
export function geometry(width,height,fit='contain',focus=[.5,.5],background='black') {
  integer(width,'width',2,8192);integer(height,'height',2,8192);
  if(width%2||height%2)throw new Error('Размеры должны быть чётными.');
  if(!['cover','contain'].includes(fit))throw new Error('fit: contain или cover');
  if(!Array.isArray(focus)||focus.length!==2)throw new Error('focus: [x,y] в диапазоне 0..1');
  focus.forEach(x=>number(x,'focus',0,1));
  if(!/^(black|white|0x[0-9a-fA-F]{6})$/.test(background))throw new Error('background: black, white или 0xRRGGBB');
  return fit==='contain'
    ? `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${background},setsar=1`
    : `scale=${width}:${height}:force_original_aspect_ratio=increase:force_divisible_by=2,crop=${width}:${height}:(iw-ow)*${focus[0]}:(ih-oh)*${focus[1]},setsar=1`;
}
export function loadJob(dir) {
  const root=fs.realpathSync(dir), job=read(path.join(root,'job.json')), planPath=path.join(root,'edit-plan.json');
  if(job.mode!=='capcut-desktop')throw new Error('Нужна новая desktop-папка работы.');
  const plan=read(planPath), t=job.target;
  keys(plan,['version','cuts','overlays','audio','captions','caption_style','note'],'plan');
  integer(t.width,'target.width',1080,4320);integer(t.height,'target.height',1920,7680);
  if(Math.abs(t.width/t.height-9/16)>.0001 || t.width%2 || t.height%2)throw new Error('Нужен чётный вертикальный холст 9:16 не ниже 1080×1920.');
  number(t.fps,'fps',1,120);number(t.duration_s,'duration_s',.1,3600);
  const frames=Math.round(t.duration_s*t.fps);
  if(Math.abs(frames/t.fps-t.duration_s)>1e-6)throw new Error('Длительность должна выражаться целым числом кадров.');
  if(plan.version!==1 || !Array.isArray(plan.cuts)||!plan.cuts.length)throw new Error('edit-plan.json: нужны version:1 и выбранные cuts.');
  const probes=new Map(); const info=f=>{if(!probes.has(f))probes.set(f,probe(f));return probes.get(f);};
  let cursor=0;
  const checkMedia=(item,label,kind)=>{
    const f=local(item.file,root), p=info(f); integer(item.frames,`${label}.frames`,1,frames);
    const start=item.source_start_s??0;number(start,`${label}.source_start_s`,0,864000);
    if(kind==='audio'?!p.audio:!p.video)throw new Error(`${label}: отсутствует нужный поток`);
    const still=/\.(png|jpe?g|webp)$/i.test(f);
    if(!still && (!Number.isFinite(p.duration)||start+item.frames/t.fps>p.duration+.001))throw new Error(`${label}: отрезок выходит за конец файла`);
    if(still && kind==='audio')throw new Error('Изображение не может быть звуковой дорожкой');
    number(item.gain_db??0,`${label}.gain_db`,-96,24);
    if(kind!=='audio') geometry(t.width,t.height,item.fit??'contain',item.focus??[.5,.5],item.background??'black');
    return {...item,file:f,source_start_s:start,info:p,still};
  };
  const cuts=plan.cuts.map((x,i)=>{keys(x,['file','source_start_s','frames','fit','focus','background','gain_db','zoom','zoom_anchor','why'],'cut');const c=checkMedia(x,`cuts[${i}]`,'video');const at=cursor;cursor+=c.frames;
    const zoom=x.zoom??[1,1],anchor=x.zoom_anchor??[.5,.5];
    if(!Array.isArray(zoom)||zoom.length!==2||!Array.isArray(anchor)||anchor.length!==2)throw new Error('zoom и zoom_anchor: пары чисел');
    zoom.forEach(v=>number(v,'zoom',1,1.3));anchor.forEach(v=>number(v,'zoom_anchor',0,1));return {...c,at,zoom,zoom_anchor:anchor};});
  if(cursor!==frames)throw new Error(`Сумма cuts ${cursor} кадров; нужно ${frames}. Не ускоряйте речь ради длины.`);
  const range=(x,label)=>{integer(x.at,`${label}.at`,0,frames-1);integer(x.frames,`${label}.frames`,1,frames);if(x.at+x.frames>frames)throw new Error(`${label}: за концом ролика`);};
  const overlays=(plan.overlays??[]).map((x,i)=>{
    keys(x,['file','source_start_s','at','frames','fit','focus','background','rect','fade_s','why'],'overlay');
    range(x,`overlays[${i}]`);const v=checkMedia(x,`overlays[${i}]`,'video');
    const rect=x.rect??[0,0,t.width,t.height];if(!Array.isArray(rect)||rect.length!==4)throw new Error('rect: [x,y,width,height]');
    rect.forEach((n,i)=>integer(n,'rect',i<2?0:2,8192));if(rect.some(n=>n%2)||rect[0]+rect[2]>t.width||rect[1]+rect[3]>t.height)throw new Error('rect должен быть чётным и находиться внутри кадра');
    number(x.fade_s??0,'fade_s',0,x.frames/t.fps/2);return {...v,rect};
  });
  const audio=(plan.audio??[]).map((x,i)=>{keys(x,['file','source_start_s','at','frames','gain_db','why'],'audio');range(x,`audio[${i}]`);return checkMedia(x,`audio[${i}]`,'audio');});
  let captionEnd=0;
  const captions=(plan.captions??[]).map((x,i)=>{
    keys(x,['at','frames','text','style'],'caption');
    if(x.style!==undefined){
      if(!x.style||typeof x.style!=='object'||Array.isArray(x.style))throw new Error('caption.style: объект');
      keys(x.style,['x','y','size_px'],'caption.style');
      if(x.style.x!==undefined)number(x.style.x,'caption x',0,t.width);
      if(x.style.y!==undefined)number(x.style.y,'caption y',0,t.height);
      if(x.style.size_px!==undefined)number(x.style.size_px,'caption size_px',12,160);
    }
    range(x,`captions[${i}]`);if(typeof x.text!=='string'||!x.text.trim())throw new Error('Пустой субтитр');
    if(x.at<captionEnd)throw new Error('Субтитры должны быть по времени и без наложений');captionEnd=x.at+x.frames;
    if(/[{}\\]/.test(x.text))throw new Error('В субтитрах запрещены управляющие символы ASS { } и обратный слэш');return x;
  });
  const style={font:'Onest',font_file:path.join(SOURCE,'assets/fonts/Onest-Bold.ttf'),size_px:64,color:'#FFFFFF',outline_color:'#161616',outline_px:3,x:t.width/2,y:Math.round(t.height*.78),...plan.caption_style};
  keys(style,['font','font_file','size_px','color','outline_color','outline_px','x','y'],'caption_style');
  if(captions.length){style.font_file=local(style.font_file,root);number(style.size_px,'size_px',12,160);number(style.x,'text x',0,t.width);number(style.y,'text y',0,t.height);number(style.outline_px,'outline_px',0,12);for(const c of [style.color,style.outline_color])if(!/^#[0-9a-fA-F]{6}$/.test(c))throw new Error('Цвет субтитров #RRGGBB');if(typeof style.font!=='string'||/[\r\n,]/.test(style.font))throw new Error('Некорректное семейство шрифта');}
  return {root,job,plan,target:t,frames,cuts,overlays,audio,captions,style,plan_hash:hash(planPath),job_hash:hash(path.join(root,'job.json'))};
}
export function locked(root,fn){
  const lock=path.join(root,'.desktop-work.lock');let fd;
  try{fd=fs.openSync(lock,'wx');}catch(e){throw new Error(`Папка занята другим процессом (${lock}). Не удаляйте блокировку, пока процесс работает.`);}
  try{fs.writeFileSync(fd,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return fn();}finally{fs.closeSync(fd);fs.unlinkSync(lock);}
}
