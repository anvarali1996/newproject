"use client";
import {useEffect,useState,useRef} from 'react';

export default function Home(){
  const [init,setInit]=useState('');
  const [user,setUser]=useState(null);
  const [mode,setMode]=useState('image');
  const [file,setFile]=useState(null);
  const [prompt,setPrompt]=useState('');
  const [busy,setBusy]=useState(false);
  const [jobId,setJobId]=useState('');
  const [job,setJob]=useState(null);
  const [error,setError]=useState('');
  const stopRef=useRef(false);
  const api=async(path,method='GET',body=null,authData=init)=>{
    const res=await fetch(path,{
      method,headers:{'x-telegram-init-data':authData,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'
    });
    const data=await res.json();
    if(!res.ok)throw new Error(data.error||'Request failed');
    return data;
  };
  useEffect(()=>{
    const tg=window.Telegram?.WebApp;
    tg?.ready();tg?.expand();
    const value=tg?.initData|| (location.hostname==='localhost'?'dev:local':'');
    setInit(value);
    if(value)fetch('/api/me',{headers:{'x-telegram-init-data':value},cache:'no-store'})
      .then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setUser(d.user);})
      .catch(e=>setError(e.message));
  },[]);
  useEffect(()=>{
    if(!jobId||!init)return;
    stopRef.current=false;
    let timer;
    const poll=async()=>{
      try{
        const j=await api(`/api/status/${jobId}`);
        if(stopRef.current)return;
        setJob(j);
        if(j.status==='SUCCEEDED'||j.status==='FAILED')return;
      }catch(e){if(!stopRef.current)setError(e.message);}
      timer=setTimeout(poll,5000);
    };
    poll();
    return ()=>{stopRef.current=true;clearTimeout(timer);};
  },[jobId,init]);
  async function generate(e){
    e.preventDefault();setError('');setJob(null);
    if(!file)return setError('Select an image or MP4 video');
    setBusy(true);
    try{
      const signed=await api('/api/upload','POST',{type:file.type,size:file.size,mode});
      const upload=await fetch(signed.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});
      if(!upload.ok)throw new Error(`R2 upload failed: ${upload.status} (check CORS)`);
      const created=await api('/api/generate','POST',{mode,key:signed.key,prompt});
      setJobId(created.id);
      setUser(old=>old?{...old,credits:created.remaining}:old);
    }catch(e){setError(e.message);}
    finally{setBusy(false);}
  }
  return <main className="shell">
    <span className="tag">✨ Telegram Mini App</span>
    <h1>VisionAI Studio</h1>
    <p>Turn a photo into a short clip, or edit an uploaded video using an AI prompt.</p>
    <div className="card">
      {!init?<p className="error">Open this app inside Telegram. Localhost also supports demo mode.</p>:<div>👤 {user?.first_name||'Connecting...'} &nbsp; • &nbsp; 🪙 {user?.credits??'...'} credits</div>}
      <form onSubmit={generate}>
        <h3>1. Choose mode</h3>
        <div className="tabs"><button type="button" className={mode==='image'?'selected':''} onClick={()=>{setMode('image');setFile(null);}}>📷 Image → Video (1 credit)</button><button type="button" className={mode==='video'?'selected':''} onClick={()=>{setMode('video');setFile(null);}}>🎬 Video → Video (3 credits)</button></div>
        <h3>2. Upload {mode==='image'?'image':'MP4 video'}</h3>
        <input className="field" type="file" accept={mode==='image'?'image/jpeg,image/png,image/webp':'video/mp4'} onChange={e=>setFile(e.target.files?.[0]||null)} required />
        <small>{mode==='image'?'JPEG, PNG or WebP; max 10MB':'MP4, max 50MB. Aleph 2.0 input duration: 2–30 seconds.'}</small>
        <h3>3. Describe the result</h3>
        <textarea className="field" placeholder={mode==='image'?'Camera slowly moves toward the person, cinematic lighting...':'Make the street snowy at night; preserve all original camera movement...'} value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={1000} minLength={4} required />
        <label style={{display:'block',fontSize:13}}><input type="checkbox" required/> I own this media or have permission to edit it.</label>
        <button className="primary" disabled={!init||busy||!user} type="submit">{busy?'Uploading and starting...':'✨ Generate video'}</button>
      </form>
    </div>
    {error&&<p className="error">⚠ {error}</p>}
    {job&&<div className="card"><h3>Generation: {job.status}</h3><p>{job.message||'You can keep this screen open while AI is working.'}</p>{job.status==='SUCCEEDED'&&job.url&&<><video controls src={job.url}/><p><a target="_blank" rel="noopener noreferrer" href={job.url}>Download your video</a></p></>}{job.status==='FAILED'&&<p className="error">Generation failed. Check credits or try again.</p>}</div>}
    <small>Runway may charge for submitted tasks. Premium / referrals are not enabled in this MVP.</small>
  </main>;
}
