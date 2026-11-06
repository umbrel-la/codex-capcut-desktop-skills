"""Full-source local ASR. Explicit existing model directory; no implicit downloads or paid API."""
import argparse, json, pathlib, subprocess, sys, tempfile, os

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--source', required=True); p.add_argument('--out', required=True)
    p.add_argument('--model', required=True, help='Existing faster-whisper/CTranslate2 model DIRECTORY')
    p.add_argument('--language', default='ru'); p.add_argument('--device', choices=['cpu','cuda'], default='cpu')
    a=p.parse_args(); src=pathlib.Path(a.source).resolve(strict=True); out=pathlib.Path(a.out).resolve(); model=pathlib.Path(a.model).resolve(strict=True)
    if out.exists(): raise ValueError('Результат уже существует; используйте другое имя или продолжите с сохранённым текстом.')
    if not model.is_dir() or not (model/'model.bin').is_file(): raise ValueError('Нужна локальная модель faster-whisper; ggml-модель whisper.cpp не подходит.')
    os.environ['HF_HUB_OFFLINE']='1'; os.environ['TRANSFORMERS_OFFLINE']='1'
    from faster_whisper import WhisperModel
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-of','json',str(src)],text=True))
    duration=float(probe['format']['duration']); out.parent.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='codex-asr-') as tmp:
        wav=pathlib.Path(tmp)/'speech.wav'
        subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-nostdin','-n','-i',str(src),'-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',str(wav)],check=True)
        engine=WhisperModel(str(model),device=a.device,compute_type='int8' if a.device=='cpu' else 'float16',local_files_only=True)
        stream,info=engine.transcribe(str(wav),language=a.language,word_timestamps=True,vad_filter=True)
        segments=[]; words=[]
        for s in stream:
            segments.append({'start':s.start,'end':s.end,'text':s.text})
            words.extend({'start':w.start,'end':w.end,'text':w.word,'probability':w.probability} for w in s.words or [])
            print(f'ASR: {s.end:.1f}/{duration:.1f} s',file=sys.stderr,flush=True)
        if not words: raise RuntimeError('Речь не распознана; не считать пустой текст успешной расшифровкой.')
        result={'source':str(src),'model':str(model),'source_duration_s':duration,'processed_full_source':True,'language':info.language,'segments':segments,'words':words}
        with out.open('x',encoding='utf-8') as f: json.dump(result,f,ensure_ascii=False,indent=2)
    print(json.dumps({'transcript':str(out),'words':len(words),'duration_s':duration},ensure_ascii=False))

if __name__=='__main__':
    try: main()
    except Exception as e: print(str(e),file=sys.stderr);sys.exit(1)
