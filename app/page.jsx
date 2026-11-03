"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {PACKS,priceFor} from '../lib/pricing.js';
import {PRESETS,buildPrompt} from '../lib/prompt-presets.js';

const MODES=[
  {id:'image',icon:'✦',title:'Photo to Video',subtitle:'Bring a photo to life',detail:'5 or 10 sec',rate:'1 credit/sec'},
  {id:'act',icon:'◈',title:'Me in Video',subtitle:'Animate your portrait with a performance video',detail:'3–10 sec',rate:'2 credits/sec'},
  {id:'video',icon:'▣',title:'Video Remix',subtitle:'Replace multiple people or restyle a clip',detail:'2–10 sec',rate:'Choose an option'}
];
function UploadField({title,sub,file,onChange,accept}){
  return <label className={`uploadBox ${file?'hasFile':''}`}>
    <span className="uploadIcon">{file?'✓':'↑'}</span>
    <span className="uploadTitle">{file?file.name:title}</span>
    <span className="uploadHint">{file?`${(file.size/1024/1024).toFixed(1)} MB · Tap to replace`:sub}</span>
    <input type="file" accept={accept} onChange={e=>onChange(e.target.files?.[0]||null)} />
  </label>;
}
function PersonPreview({src,init}){
  const [image,setImage]=useState('');
  useEffect(()=>{
    if(!src||!init)return;
    let active=true,url='';
    fetch(src,{headers:{'x-telegram-init-data':init}})
      .then(r=>{if(!r.ok)throw Error('Preview not available');return r.blob();})
      .then(blob=>{url=URL.createObjectURL(blob);if(active)setImage(url);else URL.revokeObjectURL(url);})
      .catch(()=>{});
    return()=>{active=false;if(url)URL.revokeObjectURL(url);};
  },[src,init]);
  return image?<img src={image} alt="Detected person preview" className="facePreview"/>:<div className="facePlaceholder">◉</div>;
}
function ProcessingPanel({stage,progress}){
  const labels={
    uploading:'Uploading files securely',analyzing:'Finding people in the video',
    rendering:'AI is creating your video',stitching:'Combining the scenes',
    saving:'Saving your finished video',pending:'Waiting in the generation queue'
  };
  const label=labels[stage]||stage||'Preparing video';
  return <div className="progressPanel" role="status" aria-live="polite">
    <div className="progressOrbit"><span>✦</span><i/></div>
    <strong>{label}</strong>
    <small>This may take several minutes. The app is still working.</small>
    <div className="progressTrack"><div className={progress==null?'progressIndeterminate':'progressFill'} style={progress!=null?{width:`${progress}%`}:undefined}/></div>
    {progress!=null?<small>{progress}% complete</small>:<small>Checking the AI service for updates…</small>}
  </div>;
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
  const [preset,setPreset]=useState('natural'),[extraPrompt,setExtraPrompt]=useState(''),[rates,setRates]=useState(null);
  const [referral,setReferral]=useState(null),[shareState,setShareState]=useState('');
  const [consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
  const [jobId,setJobId]=useState(''),[job,setJob]=useState(null),[error,setError]=useState(''),[step,setStep]=useState('');
  const [tab,setTab]=useState('create'),[payBusy,setPayBusy]=useState('');
  const [videoWorkflow,setVideoWorkflow]=useState('people');
  const [scanId,setScanId]=useState(''),[scanStatus,setScanStatus]=useState(''),[detectedPeople,setDetectedPeople]=useState([]);
  const [faceFiles,setFaceFiles]=useState({}),[swapCost,setSwapCost]=useState(null),[swapRate,setSwapRate]=useState(12);
  const [scanProgress,setScanProgress]=useState(null),[swapUrl,setSwapUrl]=useState(''),[telegramDelivery,setTelegramDelivery]=useState('');
  const [scanBusy,setScanBusy]=useState(false);
  const [swapEnabled,setSwapEnabled]=useState(false);
  const stopRef=useRef(false);
  const api=useCallback(async(path,method='GET',body=null)=>{
    const res=await fetch(path,{method,headers:{'x-telegram-init-data':init,...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),cache:'no-store'});
    let data;try{data=await res.json();}catch{throw Error(`API ${res.status}: invalid response`);}
    if(!res.ok)throw Error(data.error||`API ${res.status}`);
    return data;
  },[init]);
  const refreshUser=useCallback(async()=>{if(init){const d=await api('/api/me');setUser(d.user);setReferral(d.referral);}},[init,api]);
  useEffect(()=>{
    // Resume a video that was still processing if the Mini App was closed.
    try{const previous=window.localStorage.getItem('visionai:lastSwapId');if(previous&&/^[0-9a-f-]{36}$/i.test(previous)){setMode('video');setVideoWorkflow('people');setScanId(previous);setScanStatus('ANALYZING');}}catch{}
    const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();
    const value=tg?.initData||(location.hostname==='localhost'?'dev:local':'');
    setInit(value);
  },[]);
  useEffect(()=>{if(init){refreshUser().catch(e=>setError(e.message));api('/api/pricing').then(x=>{setRates(x.rates);setSwapEnabled(!!x.swapEnabled);setSwapRate(x.swapRate||12);}).catch(e=>setError(e.message));}},[init,refreshUser,api]);
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
    if(!scanId||!init||['READY','FAILED','SUCCEEDED'].includes(scanStatus))return;
    let cancelled=false,timer;
    const poll=async()=>{
      try{
        const x=await api(`/api/swap/status/${scanId}`);
        if(cancelled)return;
        setScanStatus(x.status||'ANALYZING');
        setScanProgress(x.progress??null);
        if(x.status==='READY'){
          setDetectedPeople(x.people||[]);
          setSwapCost(x.cost);
          setSwapRate(x.rate||12);
          return;
        }
        if(x.status==='SUCCEEDED'){
          setSwapUrl(x.url||'');setTelegramDelivery(x.telegram||'');
          refreshUser().catch(()=>{});
          return;
        }
        if(x.status==='FAILED'){
          setError(x.message||'Video processing failed');refreshUser().catch(()=>{});return;
        }
      }catch(err){if(!cancelled)setError(err.message);}
      if(!cancelled)timer=setTimeout(poll,5000);
    };
    poll();
    return()=>{cancelled=true;clearTimeout(timer);};
  },[scanId,scanStatus,init,api,refreshUser]);
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
  try{if(rates)cost=priceFor(mode,rawSeconds,rates);}catch{}
  function resetScan(){try{window.localStorage.removeItem('visionai:lastSwapId');}catch{}setScanId('');setScanStatus('');setDetectedPeople([]);setFaceFiles({});setSwapCost(null);setScanProgress(null);setSwapUrl('');}
  function selectMode(m){setMode(m);setMainFile(null);setPhoto(null);setVideoSeconds(0);setPreset(PRESETS[m]?.[0]?.id||'natural');setExtraPrompt('');setError('');setConsent(false);resetScan();}
  function updateVideo(file){setMainFile(file);resetScan();setError('');}
  async function upload(file,fileMode=mode){
    const signed=await api('/api/upload','POST',{type:file.type,size:file.size,mode:fileMode});
    const r=await fetch(signed.uploadUrl,{method:'PUT',headers:{'Content-Type':file.type},body:file});
    if(!r.ok)throw Error(`R2 upload failed: ${r.status}`);
    return signed.key;
  }
  async function analyzePeople(){
    setError('');resetScan();
    if(!mainFile)return setError('Upload a source MP4 video first.');
    if(!consent)return setError('Please confirm you have permission from everyone shown.');
    if(!user||!init)return setError('Open this Mini App inside Telegram first.');
    setScanBusy(true);setScanStatus('UPLOADING');setStep('Uploading the source video');
    try{
      const key=await upload(mainFile,'swap');
      setScanStatus('ANALYZING');
      const result=await api('/api/swap/analyze','POST',{videoKey:key,consent:true});
      setScanId(result.id);try{window.localStorage.setItem('visionai:lastSwapId',result.id);}catch{}setScanProgress(null);
    }catch(err){setError(err.message);setScanStatus('');}
    finally{setScanBusy(false);}
  }
  async function renderPeople(){
    setError('');
    if(!detectedPeople.length||!scanId)return setError('Analyze the video first.');
    if(detectedPeople.some(person=>!faceFiles[person.id]))return setError('Upload one photo for each detected person.');
    if(!consent)return setError('You must have permission from everyone shown.');
    if(user?.credits<(swapCost??Infinity)){
      setTab('credits');return setError(`You need ${swapCost} credits for this video.`);
    }
    setScanBusy(true);setScanStatus('UPLOADING');setStep('Uploading reference portraits');
    try{
      const imageKeys={};
      for(const person of detectedPeople)imageKeys[person.id]=await upload(faceFiles[person.id],'swap');
      const created=await api('/api/swap/render','POST',{id:scanId,imageKeys});
      setUser(old=>old?{...old,credits:created.remaining}:old);
      setScanStatus('RENDERING');setScanProgress(null);
      // A fresh poll effect is also needed if this ID has not changed.
    }catch(err){setError(err.message);setScanStatus('READY');}
    finally{setScanBusy(false);}
  }
  async function generate(e){
    e.preventDefault();
    if(mode==='video'&&videoWorkflow==='people')return renderPeople();
    setError('');setJob(null);setJobId('');
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
      const created=await api('/api/generate','POST',{mode,key,videoKey,presetId:safePreset,extraPrompt,seconds});
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
  const availablePresets=PRESETS[mode]||[];
  const safePreset=availablePresets.some(p=>p.id===preset)?preset:availablePresets[0]?.id;
  let previewPrompt='';
  try{if(mode!=='act'&&safePreset)previewPrompt=buildPrompt(mode,safePreset,extraPrompt);}catch{}
  function shareInvite(){
    if(!referral?.url)return setShareState('Set TELEGRAM_BOT_USERNAME in Vercel first.');
    const share=`https://t.me/share/url?url=${encodeURIComponent(referral.url)}&text=${encodeURIComponent('Create AI videos with VisionAI ✨')}`;
    if(window.Telegram?.WebApp?.openTelegramLink)window.Telegram.WebApp.openTelegramLink(share);
    else window.open(share,'_blank','noopener,noreferrer');
  }
  async function copyInvite(){
    if(!referral?.url)return;
    try {await navigator.clipboard.writeText(referral.url);setShareState('Copied invite link!');}
    catch {setShareState('Long-press the link and copy it.');}
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
    <div className="segmented"><button className={tab==='create'?'active':''} onClick={()=>setTab('create')} type="button">✦ Create</button><button className={tab==='credits'?'active':''} onClick={()=>setTab('credits')} type="button">✧ Credits</button><button className={tab==='invite'?'active':''} onClick={()=>setTab('invite')} type="button">🎁 Invite</button></div>
    {tab==='create'?<>
      <div className="sectionLabel"><span>01</span> Choose your magic</div>
      <div className="modeGrid">{MODES.map(m=><button key={m.id} type="button" aria-pressed={mode===m.id} className={`modeCard ${mode===m.id?'chosen':''}`} onClick={() => selectMode(m.id)}><span className="selectedTick">{mode===m.id?'✓ Selected':'Choose'}</span><span className="modeGlyph">{m.icon}</span><strong>{m.title}</strong><span className="modeSub">{m.subtitle}</span><span className="modeRate">{m.id==='video'?videoWorkflow==='people'?`Multi-face · ${swapRate} credits/sec`:`${rates?.video??'…'} credits/sec`:`${rates?.[m.id]??'…'} credits/sec`}</span></button>)}</div>
      {mode==='video'&&<div className="workflowTabs" role="group" aria-label="Video Remix type">
        <button type="button" aria-pressed={videoWorkflow==='people'} className={videoWorkflow==='people'?'active':''} onClick={()=>{setVideoWorkflow('people');resetScan();setMainFile(null);setError('')}}>👥 Replace people</button>
        <button type="button" aria-pressed={videoWorkflow==='style'} className={videoWorkflow==='style'?'active':''} onClick={()=>{setVideoWorkflow('style');resetScan();setMainFile(null);setError('')}}>🎨 Change style</button>
      </div>}
      {mode==='video'&&videoWorkflow==='people'?<div className="peopleWorkflow">
        <div className="sectionLabel"><span>02</span> Upload the original video</div>
        <UploadField title="Choose the video with people" sub="MP4 · 2–10 seconds · up to 50 MB" file={mainFile} onChange={updateVideo} accept="video/mp4"/>
        <div className="durationInfo">{videoSeconds?`Original video: ${videoSeconds.toFixed(1)} seconds`:'We will find the people in your video. No face photos needed yet.'}</div>
        <label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>I have permission from everyone shown and from every person whose photo I upload. I will not use this to impersonate anyone.</span></label>
        {!swapEnabled&&<div className="notice">Multi-person replacement needs an additional face-swap provider. Add LOVELY_API_KEY in Vercel; the existing Runway key cannot perform this workflow.</div>}
        {!scanId&&<button className="cta" type="button" disabled={!mainFile||!consent||scanBusy||!swapEnabled} onClick={analyzePeople}>🔍 Find people in video</button>}
        {scanId&&detectedPeople.length>0&&<>
          <div className="sectionLabel"><span>03</span> We found {detectedPeople.length} {detectedPeople.length===1?'person':'people'}</div>
          <p className="muted">Upload a separate portrait for each detected person. The photo next to Person 1 replaces Person 1, and so on.</p>
          <div className="faceGrid">{detectedPeople.map((person,index)=><div className="faceRow" key={person.id}>
            <div className="faceDetail"><PersonPreview src={person.preview} init={init}/><div><strong>Person {index+1}</strong><small>Detected in source video</small></div></div>
            <UploadField title={`Replacement photo for Person ${index+1}`} sub="Portrait · JPG, PNG, WebP" file={faceFiles[person.id]||null} onChange={file=>setFaceFiles(old=>({...old,[person.id]:file}))} accept="image/jpeg,image/png,image/webp"/>
          </div>)}</div>
          <div className="checkout"><div><small>Video cost</small><b>{swapCost??'—'} credits</b></div><div><small>Your balance</small><b>{user?.credits??'—'} credits</b></div></div>
          <button type="button" className="cta" disabled={scanBusy||['RENDERING','STITCHING','SAVING','SUCCEEDED'].includes(scanStatus)||detectedPeople.some(x=>!faceFiles[x.id])} onClick={renderPeople}>✦ Replace {detectedPeople.length} people · {swapCost??'—'} credits</button>
        </>}
        {(['UPLOADING','ANALYZING','RENDERING','STITCHING','SAVING','SUBMITTING'].includes(scanStatus)||scanBusy)&&<ProcessingPanel stage={scanStatus==='UPLOADING'?'uploading':scanStatus.toLowerCase()} progress={scanProgress}/>}
        {scanStatus==='SUCCEEDED'&&swapUrl&&<div className="result"><h3>🎬 Your video is ready!</h3><video playsInline controls src={swapUrl}/><a className="download" href={swapUrl} target="_blank" rel="noreferrer">Download your video ↗</a><p>{telegramDelivery==='sent'?'Sent to your Telegram chat!':'The video is ready here. Open the bot and press Start to enable Telegram delivery.'}</p></div>}
        {scanStatus==='FAILED'&&<div className="notice">Analysis or rendering failed. Change the video and try again. Any charged credits should be refunded.</div>}
      </div>:<form onSubmit={generate}>
        <div className="sectionLabel"><span>02</span> Add your media</div>
        {mode==='act'&&<><UploadField title="Upload your portrait" sub="Clear front-facing image · JPG, PNG, WebP · up to 10 MB" file={photo} onChange={setPhoto} accept="image/jpeg,image/png,image/webp"/><div className="fieldCaption">Then choose a video whose facial expressions and movements you want to follow.</div></>}
        <UploadField title={mode==='image'?'Upload a photo':'Upload your video'} sub={mode==='image'?'JPG, PNG or WebP · up to 10 MB':'MP4 · 2–10s for remix, 3–10s for Me in Video · up to 50 MB'} file={mainFile} onChange={updateVideo} accept={mode==='image'?'image/jpeg,image/png,image/webp':'video/mp4'}/>
        {mode==='image'?<><div className="sectionLabel"><span>03</span> Duration</div><div className="duration"><button type="button" className={seconds===5?'active':''} onClick={()=>setSeconds(5)}>5 seconds</button><button type="button" className={seconds===10?'active':''} onClick={()=>setSeconds(10)}>10 seconds</button></div></>:<div className="durationInfo">{videoSeconds?`Video duration: ${videoSeconds.toFixed(1)}s · billed as ${Math.ceil(videoSeconds)}s`:'Video duration will be checked automatically'}</div>}
        {mode!=='act'?<>
          <div className="sectionLabel"><span>{mode==='image'?'04':'03'}</span> Choose your style — no prompt needed</div>
          <div className="presetGrid">{availablePresets.map(p=><button key={p.id} type="button" className={`presetCard ${preset===p.id?'selected':''}`} onClick={()=>setPreset(p.id)}><span>{p.icon}</span><strong>{p.name}</strong><small>{p.description}</small></button>)}</div>
          <details className="advanced"><summary>✎ Optional: add an instruction</summary><textarea className="prompt" value={extraPrompt} onChange={e=>setExtraPrompt(e.target.value)} maxLength={300} placeholder="For example: gentle wind, keep colors natural…"/><small>Up to 300 characters. Optional.</small></details>
          <details className="preview"><summary>See AI-generated prompt</summary><p>{previewPrompt}</p></details>
        </>:<div className="notice"><strong>No prompt required for Me in Video.</strong><br/>Upload a clear portrait and an MP4 movement video with one visible person. Act-Two transfers gestures and expressions; it does not guarantee exact face replacement or preservation of the original background.</div>}
        <label className="consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} required/><span>I own these files or have permission from everyone depicted. I won’t impersonate someone without consent.</span></label>
        <div className="checkout"><div><small>Estimated price</small><b>{cost===null?'—':`${cost} credits`}</b></div><div><small>Your balance</small><b>{user?.credits??'—'} credits</b></div></div>
        <button type="submit" className="cta" disabled={!init||!user||busy||cost===null}>{busy?step:`✦ Generate video · ${cost??'—'} credits`}</button>
      </form>}
      {((busy||job&& !['SUCCEEDED','FAILED'].includes(job.status))&& !(mode==='video'&&videoWorkflow==='people'))&&<ProcessingPanel stage={busy?'uploading':job?.status==='SAVING'?'saving':'rendering'} progress={null}/>}
      {job&&<div className="result"><h3>{job.status==='SUCCEEDED'?'Your video is ready ✦':'Generation · '+job.status}</h3><p>{job.message||'You can leave this screen open while we create your video.'}</p>{job.status==='SUCCEEDED'&&job.url&&<><video controls playsInline src={job.url}/><a className="download" href={job.url} target="_blank" rel="noreferrer">Download video ↗</a></>}{job.status==='FAILED'&&<p>Your credit is refunded when Runway reports a generation failure.</p>}</div>}
    </>:tab==='credits'?<><div className="sectionLabel"><span>✦</span> Credit packs</div><p className="muted">Create more videos with Telegram Stars. You’ll receive credits after confirmed payment.</p><div className="packs">{Object.entries(PACKS).map(([id,p])=><div className={`pack ${id==='creator'?'recommended':''}`} key={id}><div><span className="packName">{p.label}</span><strong>{p.credits} <small>credits</small></strong></div><button type="button" onClick={()=>buy(id)} disabled={!!payBusy}>{payBusy===id?'Opening…':`${p.stars} ⭐ Stars`}</button></div>)}</div><div className="notice">Payments are processed in Telegram Stars. Credits are added only after Telegram confirms your payment. Prices may change after real-world cost tests.</div></>:<section className="inviteBox"><span className="inviteEmoji">🎁</span><h2>Invite friends. Earn credits.</h2><p>Get <strong>2 credits</strong> when a new friend opens VisionAI for the first time through your link.</p><div className="inviteStats"><div><strong>{referral?.invited??'—'}</strong><small>Friends invited</small></div><div><strong>{referral?.earned??'—'}</strong><small>Credits earned</small></div></div>{referral?.url?<><div className="inviteLink">{referral.url}</div><div className="inviteActions"><button type="button" onClick={shareInvite}>Share in Telegram</button><button type="button" onClick={copyInvite}>Copy link</button></div></>:<p className="notice">Set TELEGRAM_BOT_USERNAME and TELEGRAM_APP_SHORT_NAME in Vercel to activate the invite link.</p>}{shareState&&<p className="muted">{shareState}</p>}<p className="inviteFine">Only new, verified Telegram users count. No self-referrals. Max 10/day and 100 total. Invite credits have no cash value.</p></section>}
    {error&&<div className="error">⚠ {error}</div>}
    <footer>VisionAI · AI-generated videos · Use media you have permission to edit</footer>
  </main>;
}
