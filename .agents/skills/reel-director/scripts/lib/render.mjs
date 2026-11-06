import fs from 'node:fs';
import path from 'node:path';
import {loadJob,write,read,run,probe,hash,geometry,locked,id} from './media.mjs';

const ff=args=>run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n','-filter_threads','1','-filter_complex_threads','1',...args]);
const input=(c,fps)=>c.still?['-loop','1','-framerate',String(fps),'-i',c.file]:['-ss',String(c.source_start_s),'-i',c.file];
const fingerprint=f=>{const s=fs.statSync(f);return {file:f,bytes:s.size,mtime_ms:s.mtimeMs};};
export function prepare(dir){
  return locked(dir,()=>{
    const V=loadJob(dir),{width:W,height:H,fps}=V.target;
    const out=path.join(V.root,'prepared',id());fs.mkdirSync(out,{recursive:true});
    const result={plan_hash:V.plan_hash,job_hash:V.job_hash,root:out,cuts:[],overlays:[],audio:[],source_files:[...new Set([...V.cuts,...V.overlays,...V.audio].map(c=>c.file))].map(fingerprint)};
    for(const [i,c] of V.cuts.entries()){
      const file=path.join(out,`cut-${i+1}.mp4`),d=c.frames/fps;
      const args=input(c,fps);if(!c.info.audio||c.still)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
      const g=geometry(W,H,c.fit??'contain',c.focus??[.5,.5],c.background??'black');
      args.push('-map','0:v:0','-map',c.info.audio&&!c.still?'0:a:0':'1:a:0','-vf',`${g},fps=${fps},trim=end_frame=${c.frames},setpts=PTS-STARTPTS`,
        '-af',`aresample=48000,asetpts=PTS-STARTPTS,volume=${c.gain_db??0}dB,afade=t=in:d=0.005,afade=t=out:st=${Math.max(0,d-.005)}:d=0.005,apad,atrim=duration=${d}`,
        '-t',String(d),'-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-ar','48000','-ac','2','-movflags','+faststart',file);
      ff(args);result.cuts.push({...c,info:undefined,file,original_file:c.file,source_start_s:0,sha256:hash(file)});
    }
    for(const [i,c] of V.overlays.entries()){
      const file=path.join(out,`overlay-${i+1}.mov`),[x,y,w,h]=c.rect,d=c.frames/fps,f=c.fade_s??0;
      let g=geometry(w,h,c.fit??'contain',c.focus??[.5,.5],c.background??'black');
      // Full-canvas alpha media avoids landscape assumptions in CapCut clip transforms.
      g=`format=rgba,${g.replace(/color=black$/, 'color=black@0')},format=rgba,pad=${W}:${H}:${x}:${y}:color=black@0,fps=${fps},trim=end_frame=${c.frames},setpts=PTS-STARTPTS`;
      if(f)g+=`,fade=t=in:st=0:d=${f}:alpha=1,fade=t=out:st=${d-f}:d=${f}:alpha=1`;
      ff([...input(c,fps),'-an','-vf',g,'-t',String(d),'-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','16',file]);
      result.overlays.push({...c,info:undefined,file,original_file:c.file,source_start_s:0,sha256:hash(file)});
    }
    for(const [i,c] of V.audio.entries()){
      const file=path.join(out,`audio-${i+1}.wav`),d=c.frames/fps;
      ff(['-ss',String(c.source_start_s),'-i',c.file,'-vn','-af',`asetpts=PTS-STARTPTS,volume=${c.gain_db??0}dB,afade=t=in:d=0.01,afade=t=out:st=${Math.max(0,d-.05)}:d=0.05`,'-t',String(d),'-ar','48000','-ac','2','-c:a','pcm_s24le',file]);
      result.audio.push({...c,info:undefined,file,original_file:c.file,source_start_s:0,sha256:hash(file)});
    }
    write(path.join(V.root,'prepared.json'),result);return {status:'prepared',cuts:result.cuts.length,overlays:result.overlays.length,audio:result.audio.length,directory:out};
  });
}
export function prepared(V){
  const p=read(path.join(V.root,'prepared.json'));
  if(p.plan_hash!==V.plan_hash||p.job_hash!==V.job_hash)throw new Error('План изменён: снова выполните prepare.');
  for(const s of p.source_files){const now=fingerprint(s.file);if(now.bytes!==s.bytes||now.mtime_ms!==s.mtime_ms)throw new Error(`Исходный файл изменён: ${s.file}; снова prepare.`);}
  for(const c of [...p.cuts,...p.overlays,...p.audio])if(hash(c.file)!==c.sha256)throw new Error(`Подготовленный файл изменён: ${c.file}`);
  return p;
}
const assTime=s=>{const n=Math.round(s*100);return `${Math.floor(n/360000)}:${String(Math.floor(n/6000)%60).padStart(2,'0')}:${String(Math.floor(n/100)%60).padStart(2,'0')}.${String(n%100).padStart(2,'0')}`;};
const srtTime=s=>{const n=Math.round(s*1000);return `${String(Math.floor(n/3600000)).padStart(2,'0')}:${String(Math.floor(n/60000)%60).padStart(2,'0')}:${String(Math.floor(n/1000)%60).padStart(2,'0')},${String(n%1000).padStart(3,'0')}`;};
const assColor=c=>'&H00'+c.slice(5,7)+c.slice(3,5)+c.slice(1,3);
export function captions(V,out){
  const {fps,width,height}=V.target,S=V.style;
  const header=`[Script Info]\nScriptType: v4.00+\nPlayResX: ${width}\nPlayResY: ${height}\nWrapStyle: 0\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,${S.font},${S.size_px},${assColor(S.color)},${assColor(S.color)},${assColor(S.outline_color)},&H00000000,-1,0,0,0,100,100,0,0,1,${S.outline_px},0,5,80,120,200,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const lines=V.captions.map(c=>{const C={...S,...c.style};return `Dialogue: 0,${assTime(c.at/fps)},${assTime((c.at+c.frames)/fps)},Default,,0,0,0,,{\\pos(${C.x},${C.y})\\fs${C.size_px}}${c.text.replace(/\r?\n/g,'\\N')}`;});
  fs.writeFileSync(path.join(out,'captions.ass'),header+lines.join('\n')+'\n');
  fs.writeFileSync(path.join(out,'captions.srt'),V.captions.map((c,i)=>`${i+1}\n${srtTime(c.at/fps)} --> ${srtTime((c.at+c.frames)/fps)}\n${c.text}\n`).join('\n'));
}
export function render(dir){
  return locked(dir,()=>{
    const V=loadJob(dir),p=prepared(V),out=path.join(V.root,'export',id());fs.mkdirSync(out,{recursive:true});
    captions(V,out);if(V.captions.length){fs.mkdirSync(path.join(out,'fonts'));fs.copyFileSync(V.style.font_file,path.join(out,'fonts',path.basename(V.style.font_file)));}
    const args=[],filters=[];let n=0;for(const c of p.cuts){
      args.push('-threads','1','-i',c.file);const [z0,z1]=c.zoom,[ax,ay]=c.zoom_anchor;
      const zoom=z0===1&&z1===1?'':`,zoompan=z='${z0}+(${z1}-${z0})*on/${Math.max(1,c.frames-1)}':x='(iw-iw/zoom)*${ax}':y='(ih-ih/zoom)*${ay}':d=1:s=${V.target.width}x${V.target.height}:fps=${V.target.fps}`;
      filters.push(`[${n}:v]setpts=PTS-STARTPTS${zoom}[v${n}];[${n}:a]atrim=duration=${c.frames/V.target.fps},asetpts=PTS-STARTPTS[a${n}]`);n++;}
    filters.push(p.cuts.map((_,i)=>`[v${i}][a${i}]`).join('')+`concat=n=${p.cuts.length}:v=1:a=1[base][voice]`);
    filters.push(`[base]settb=1/${V.target.fps},setpts=N[framebase]`);
    let video='framebase';for(const [i,c] of p.overlays.entries()){
      args.push('-threads','1','-i',c.file);filters.push(`[${n}:v]settb=1/${V.target.fps},setpts=N+${c.at}[ov${i}]`);
      const next=`layer${i}`;filters.push(`[${video}][ov${i}]overlay=0:0:eof_action=pass:repeatlast=0:enable='gte(t,${c.at/V.target.fps})*lt(t,${(c.at+c.frames)/V.target.fps})'[${next}]`);video=next;n++;
    }
    const audio=['voice'];for(const [i,c] of p.audio.entries()){
      args.push('-threads','1','-i',c.file);const label=`music${i}`;filters.push(`[${n}:a]adelay=${Math.round(c.at/V.target.fps*48000)}S:all=1[${label}]`);audio.push(label);n++;
    }
    filters.push(audio.map(x=>`[${x}]`).join('')+`amix=inputs=${audio.length}:duration=longest:normalize=0,alimiter=limit=0.891251:level=false:latency=true,apad,atrim=duration=${V.target.duration_s}[sound]`);
    if(V.captions.length){filters.push(`[${video}]ass=filename=captions.ass:fontsdir=fonts[captioned]`);video='captioned';}
    fs.writeFileSync(path.join(out,'filter.txt'),filters.join(';\n'));
    const file=path.join(out,'reel.mp4');
    run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n','-filter_complex_threads','1',...args,'-filter_complex',filters.join(';'),'-map',`[${video}]`,'-map','[sound]','-t',String(V.target.duration_s),'-r',String(V.target.fps),'-c:v','libx264','-preset','medium','-crf','17','-pix_fmt','yuv420p','-c:a','aac','-b:a','256k','-movflags','+faststart',file],{cwd:out});
    const report={file,media:probe(file),renderer:'local-ffmpeg',native_capcut_export:false,plan_hash:V.plan_hash,notes:['Субтитры ASS: оформление и переносы нужно сравнить с текстом CapCut.','Клиппинг микса ограничен локальным лимитером; native-экспорт проверяется отдельно.']};
    write(path.join(out,'render-report.json'),report);return report;
  });
}
