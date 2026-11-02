"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {PACKS,priceFor} from '../lib/pricing.js';

const MODES=[
  {id:'image',icon:'✦',title:'Photo to Video',subtitle:'Bring a photo to life',detail:'5 or 10 sec',rate:'1 credit/sec'},
  {id:'act',icon:'◈',title:'Me in Video',subtitle:'Animate your portrait with a performance video',detail:'3–10 sec',rate:'2 credits/sec'},
  {id:'video',icon:'▣',title:'Video Remix',subtitle:'Restyle an existing clip with AI',detail:'2–10 sec',rate:'6 credits/sec'}
];
function UploadField({title,sub,file,onChange,accept}){
  return <label className={`uploadBox ${file?'hasFile':''}`}>
    <span className="uploadIcon">{file?'✓':'↑'}</span>
    <span className="uploadTitle">{file?file.name:title}</span>
    <span className="uploadHint">{file?`${(file.size/1024/1024).toFixed(1)} MB · Tap to replace`:sub}</span>
    <input type="file" accept={accept} onChange={e=>onChange(e.target.files?.[0]||null)} />
  </label>;
}
function secondsOf(file){
  return new Promise((resolve,reject)=>{
    const u=URL.createObjectURL(file),v=document.createElement('video');
    v.preload='metadata';
    v.onloadedmetadata=()=>{const duration=v.duration;URL.revokeObjectURL(u);resolve(duration);};
    v.onerror=()=>{URL.revokeObjectURL(u);reject(Error('Could not read this video. Try MP4.'));};
    v.src=u;
  });
}
export default function Home(){
  const [init,setInit]=useState(''),[user,setUser]=useState(null),[mode,setMode]=useState('image');
  const [mainFile,setMainFile]=useState(null),[photo,setPhoto]=useState(null),[seconds,setSeconds]=useState(5),[videoSeconds,setVideoSeconds]=useState(0);
  const [prompt,setPrompt]=useState(''),[consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
  const [jobId,setJobId]=useState(''),[job,setJob]=useState(null),[error,setError]=useState(''),[step,setStep]=useState('');
  const [tab,setTab]=useState('create'),[payBusy,setPayBusy]=useState('');
  const stopRef=useRef(false);
  const api=useCallback(async(path,method='GET',body=null)=>{
    const res=await fetch(path,{method,headers:{'x-telegram-init-data':init,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
    let data;try{data=await res.json();}catch{throw Error(`API ${res.status}: invalid response`);}
    if(!res.ok)throw Error(data.error||`API ${res.status}`);
    return data;
  },[init]);
  const refreshUser=useCallback(async()=>{if(init){const d=await api('/api/me');setUser(d.user);}},[init,api]);
  useEffect(()=>{
    const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();
    const value=tg?.initData||(location.hostname==='localhost'?'dev:local':'');
    setInit(value);
  },[]);
  useEffect(()=>{if(init)refreshUser().catch(e=>setError(e.message));},[init,refreshUser]);
  useEffect(()=>{
    if(!jobId||!init)return;
    stopRef.current=false;let timer;
    const poll=async()=>{
      try{
        const j=await api(`/api/status/${jobId}`);
        if(stopRef.current)return;
        setJob(j);
        if(['SUCCEEDED','FAILED'].includes(j.status)){refreshUser().catch(()=>{});return;}
      }catch(e){if(!stopRef.current)setError(e.message);}
      timer=setTimeout(poll,5000);
    };
    poll();return ()=>{stopRef.current=true;clearTimeout(timer);};
  },[jobId,init,api,refreshUser]);
  useEffect(()=>{
    setVideoSeconds(0);
    const f=mode==='act'?mainFile:mode==='video'?mainFile:null;
    if(!f)return;
    let active=true;
    secondsOf(f).then(s=>{if(active)setVideoSeconds(s);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[mainFile,mode]);
  const rawSeconds=mode==='image'?seconds:videoSeconds?Math.ceil(videoSeconds):0;
  let cost=null;
  try{cost=priceFor(mode,rawSeconds);}catch{}
  function selectMode(m){setMode(m);setMainFile(null);setPhoto(null);setVideoSeconds(0);setPrompt('');setError('');setConsent(false);}
  async function upload(file){
    const signed=await api('/api/upload','POST',{type:file.type,size:file.size,mode});
    const r=await fetch(signed.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});
    if(!r.ok)throw Error(`R2 upload failed: ${r.status}`);
    return signed.key;
  }
  async function generate(e){
    e.preventDefault();setError('');setJob(null);setJobId('');
    if(!user||!init)return setError('Open inside Telegram and sign in');
    if(!mainFile || (mode==='act'&&!photo))return setError('Select the required media files');
    if(!consent)return setError('Please confirm you have permission to use these files');
    if(cost===null)return setError('Unsupported duration. Image: 5/10s, video: 2–10s, portrait: 3–10s.');
    if(user.credits<cost){setTab('credits');return setError(`You need ${cost} credits — choose a credit pack below.`);}
    setBusy(true);
    try{
      setStep('Uploading media');
      const key=await upload(mode==='act'?photo:mainFile);
      const videoKey=mode==='act'?await upload(mainFile):null;
      setStep('Creating AI task');
      const created=await api('/api/generate','POST',{mode,key,videoKey,prompt,seconds});
      setJobId(created.id);setUser(old=>old?{...old,credits:created.remaining}:old);
      setTab('create');setStep('Video is generating');
    }catch(ex){setError(ex.message);setStep('');}
    finally{setBusy(false);}
  }
  async function buy(packId){
    if(!window.Telegram?.WebApp?.openInvoice)return setError('Open this app inside Telegram to purchase credits.');
    setError('');setPayBusy(packId);
    try{
      const {invoiceUrl}=await api('/api/shop/invoice','POST',{packId});
      window.Telegram.WebApp.openInvoice(invoiceUrl,()=>{setTimeout(()=>refreshUser().catch(()=>{}),1500);});
    }catch(e){setError(e.message);}
    finally{setPayBusy('');}
  }
  return <main className="shell">
    <header className="appHeader">
      <div className="brand"><div className="brandIcon">✧</div><div><b>VisionAI</b><small>VIDEO STUDIO</small></div></div>
      <button className="balance" onClick={()=>setTab('credits')} type="button"><span>✦</span> {user?.credits??'···'} <span className="plus">+</span></button>
    </header>
    <section className="hero">
      <span className="eyebrow"><i/> CREATE WITHOUT LIMITS</span>
      <h1>Your imagination.<br/><em>In motion.</em></h1>
      <p>Create cinematic videos from photos, remake clips, or star in your own scene.</p>
      <div className="heroOrbs"><span>✦</span><span>◈</span><span>✧</span></div>
    </section>
    <div className="segmented"><button className={tab==='create'?'active':''} onClick={()=>setTab('create')} type="button">✦ Create</button><button className={tab==='credits'?'active':''} onClick={()=>setTab('credits')} type="button">✧ Credits & shop</button></div>
    {tab==='create'?<>
      <div className="sectionLabel"><span>01</span> Choose your magic</div>
      <div className="modeGrid">{MODES.map(m=><button key={m.id} type="button" className={`modeCard ${mode===m.id?'chosen':''}`} onClick={()=>selectMode(m)}><span className="modeGlyph">{m.icon}</span><strong>{m.title}</strong><span className="modeSub">{m.subtitle}</span><span className="modeRate">{m.rate}</span></button>)}</div>
      <form onSubmit={generate}>
        <div className="sectionLabel"><span>02</span> Add your media</div>
        {mode==='act'&&<><UploadField title="Upload your portrait" sub="Clear front-facing image · JPG, PNG, WebP · up to 10 MB" file={photo} onChange={setPhoto} accept="image/jpeg,image/png,image/webp"/><div className="fieldCaption">Then choose a video whose facial expressions and movements you want to follow.</div></>}
        <UploadField title={mode==='image'?'Upload a photo':'Upload your video'} sub={mode==='image'?'JPG, PNG or WebP · up to 10 MB':'MP4 · 2–10s for remix, 3–10s for Me in Video · up to 50 MB'} file={mainFile} onChange={setMainFile} accept={mode==='image'?'image/jpeg,image/png,image/webp':'video/mp4'}/>
        {mode==='image'?<><div className="sectionLabel"><span>03</span> Duration</div><div className="duration"><button type="button" className={seconds===5?'active':''} onClick={()=>setSeconds(5)}>5 seconds</button><button type="button" className={seconds===10?'active':''} onClick={()=>setSeconds(10)}>10 seconds</button></div></>:<div className="durationInfo">{videoSeconds?`Video duration: ${videoSeconds.toFixed(1)}s · billed as ${Math.ceil(videoSeconds)}s`:'Video duration will be checked automatically'}</div>}
        {mode!=='act'?<><div className="sectionLabel"><span>{mode==='image'?'04':'03'}</span> Describe your vision</div><textarea className="prompt" value={prompt} onChange={e=>setPrompt(e.target.value)} maxLength={1000} minLength={4} placeholder={mode==='image'?'Slow cinematic camera movement, dreamy sunset, subtle natural motion…':'Change the background into a futuristic neon city, preserve original movements…'} required/><div className="promptHint">Be specific about motion, atmosphere and lighting.</div></>:<p className="notice">Act-Two transfers performance from the video to the person in your image. It does not guarantee an exact face swap or preservation of the original scene. No text prompt is needed in this mode.</p>}
        <label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/><span>I own these files or have permission from everyone depicted. I won’t impersonate someone without consent.</span></label>
        <div className="checkout"><div><small>Estimated price</small><b>{cost===null?'—':`${cost} credits`}</b></div><div><small>Your balance</small><b>{user?.credits??'—'} credits</b></div></div>
        <button type="submit" className="cta" disabled={!init||!user||busy||cost===null}>{busy?step:`✦ Generate video · ${cost??'—'} credits`}</button>
      </form>
      {job&&<div className="result"><h3>{job.status==='SUCCEEDED'?'Your video is ready ✦':'Generation · '+job.status}</h3><p>{job.message||'You can leave this screen open while we create your video.'}</p>{job.status==='SUCCEEDED'&&job.url&&<><video controls playsInline src={job.url}/><a className="download" href={job.url} target="_blank" rel="noreferrer">Download video ↗</a></>}{job.status==='FAILED'&&<p>Your credit is refunded when Runway reports a generation failure.</p>}</div>}
    </>:<><div className="sectionLabel"><span>✦</span> Credit packs</div><p className="muted">Create more videos with Telegram Stars. You’ll receive credits after confirmed payment.</p><div className="packs">{Object.entries(PACKS).map(([id,p])=><div className={`pack ${id==='creator'?'recommended':''}`} key={id}><div><span className="packName">{p.label}</span><strong>{p.credits} <small>credits</small></strong></div><button type="button" onClick={()=>buy(id)} disabled={!!payBusy}>{payBusy===id?'Opening…':`${p.stars} ⭐ Stars`}</button></div>)}</div><div className="notice">Payments are processed in Telegram Stars. Credits are added only after Telegram confirms your payment. Prices may change after real-world cost tests.</div></>}
    {error&&<div className="error">⚠ {error}</div>}
    <footer>VisionAI · AI-generated videos · Use media you have permission to edit</footer>
  </main>;
}
