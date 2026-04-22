import { useState, useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react"
import * as THREE from "three"

// ── CONSTANTS ─────────────────────────────────────────────

const ATOM_COLORS = {
  C:0x404040,H:0xeeeeee,O:0xdd2222,N:0x3366dd,
  Br:0x994400,Cl:0x22aa22,S:0xddbb00,F:0x22aaaa,
  P:0xff8800,I:0x994499,default:0x888888
}
const ATOM_RADII = {
  C:0.40,H:0.28,O:0.38,N:0.38,Br:0.52,Cl:0.47,S:0.48,F:0.33,P:0.46,I:0.58,default:0.40
}

const C60_SYMBOLS = ['C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C','C']
const C60_POSITIONS = [
  [0.8475,3.0661,2.7424],
  [-0.8475,-3.0661,2.7424],
  [-1.3712,1.6949,-3.5899],
  [0.0,-0.8475,-4.1136],
  [-1.6949,3.5899,1.3712],
  [-3.0661,2.7424,0.8475],
  [-3.0661,2.7424,-0.8475],
  [3.5899,-1.3712,-1.6949],
  [-0.8475,-4.1136,0.0],
  [2.7424,-0.8475,-3.0661],
  [0.8475,-3.0661,-2.7424],
  [-0.8475,3.0661,2.7424],
  [4.1136,0.0,-0.8475],
  [3.0661,-2.7424,-0.8475],
  [1.6949,-3.5899,-1.3712],
  [0.8475,4.1136,0.0],
  [4.1136,0.0,0.8475],
  [3.0661,-2.7424,0.8475],
  [1.3712,-1.6949,3.5899],
  [-2.7424,0.8475,3.0661],
  [-4.1136,0.0,-0.8475],
  [0.0,0.8475,4.1136],
  [-0.8475,4.1136,0.0],
  [-4.1136,0.0,0.8475],
  [0.8475,3.0661,-2.7424],
  [1.6949,-3.5899,1.3712],
  [1.3712,-1.6949,-3.5899],
  [-0.8475,-3.0661,-2.7424],
  [-1.6949,-3.5899,-1.3712],
  [-2.7424,-0.8475,3.0661],
  [3.0661,2.7424,-0.8475],
  [1.3712,1.6949,3.5899],
  [3.0661,2.7424,0.8475],
  [-1.6949,-3.5899,1.3712],
  [-2.7424,0.8475,-3.0661],
  [3.5899,1.3712,1.6949],
  [0.0,-0.8475,4.1136],
  [-3.5899,-1.3712,1.6949],
  [1.3712,1.6949,-3.5899],
  [2.7424,0.8475,3.0661],
  [-3.5899,1.3712,1.6949],
  [-1.3712,-1.6949,3.5899],
  [-0.8475,3.0661,-2.7424],
  [0.0,0.8475,-4.1136],
  [-2.7424,-0.8475,-3.0661],
  [-3.5899,1.3712,-1.6949],
  [1.6949,3.5899,-1.3712],
  [3.5899,-1.3712,1.6949],
  [0.8475,-3.0661,2.7424],
  [-1.3712,-1.6949,-3.5899],
  [-3.0661,-2.7424,0.8475],
  [-3.0661,-2.7424,-0.8475],
  [2.7424,0.8475,-3.0661],
  [1.6949,3.5899,1.3712],
  [0.8475,-4.1136,0.0],
  [-1.3712,1.6949,3.5899],
  [2.7424,-0.8475,3.0661],
  [3.5899,1.3712,-1.6949],
  [-1.6949,3.5899,-1.3712],
  [-3.5899,-1.3712,-1.6949]
]

const STEP_NAMES = ['LLM Gateway','Geodesic TS','Solvation','MACE + DFT','Surface Hop','Kinetic Summary']
const SOLVENTS = [
  {value:'water',label:'Water'},{value:'methanol',label:'Methanol'},
  {value:'ethanol',label:'Ethanol'},{value:'acetonitrile',label:'Acetonitrile'},
  {value:'dmso',label:'DMSO'},{value:'acetone',label:'Acetone'},
  {value:'thf',label:'THF'},{value:'dichloromethane',label:'DCM'},
  {value:'chloroform',label:'Chloroform'},{value:'toluene',label:'Toluene'},
  {value:'hexane',label:'Hexane'},{value:'gas phase',label:'Gas Phase'},
]
// Library items are built from real completed simulations only

// ── THREE.JS PURE FUNCTIONS (no React) ────────────────────

function threeBuild(symbols, positions) {
  const group = new THREE.Group()
  let cx=0,cy=0,cz=0
  positions.forEach(p=>{cx+=p[0];cy+=p[1];cz+=p[2]})
  cx/=positions.length;cy/=positions.length;cz/=positions.length

  // Atom spheres — Rowan style: smooth, slightly glossy, clean CPK colors
  symbols.forEach((sym,i)=>{
    const color = ATOM_COLORS[sym] ?? ATOM_COLORS.default
    const r = (ATOM_RADII[sym] ?? ATOM_RADII.default) * 1.6
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 32, 24),
      new THREE.MeshStandardMaterial({
        color, metalness:0.0, roughness:0.25,
        envMapIntensity:0.4,
      })
    )
    mesh.position.set(positions[i][0]-cx, positions[i][1]-cy, positions[i][2]-cz)
    mesh.castShadow = true
    group.add(mesh)
  })

  // Bonds — Rowan uses thick dark grey cylinders
  const bondMat = new THREE.MeshStandardMaterial({color:0x222222, roughness:0.5, metalness:0.0})
  for(let i=0;i<positions.length;i++){
    for(let j=i+1;j<positions.length;j++){
      const [x1,y1,z1]=positions[i],[x2,y2,z2]=positions[j]
      const d=Math.sqrt((x2-x1)**2+(y2-y1)**2+(z2-z1)**2)
      // Bond threshold: skip H-H, use 1.9 for most, 2.3 for heavy atoms
      const isH = symbols[i]==='H'||symbols[j]==='H'
      const thresh = isH ? 1.4 : 2.0
      if(d < thresh && !(symbols[i]==='H'&&symbols[j]==='H')){
        const mid = new THREE.Vector3((x1+x2)/2-cx,(y1+y2)/2-cy,(z1+z2)/2-cz)
        const dir = new THREE.Vector3(x2-x1,y2-y1,z2-z1).normalize()
        const bond = new THREE.Mesh(
          new THREE.CylinderGeometry(0.09, 0.09, d, 12),
          bondMat
        )
        bond.position.copy(mid)
        bond.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir)
        bond.castShadow = true
        group.add(bond)
      }
    }
  }
  return group
}

function threeClear(t) {
  t.molecules.forEach(m=>t.scene.remove(m))
  t.molecules=[]
}

function threeUpdateIRC(t, frame) {
  if(!frame?.pos||!t.molecules.length) return
  const pos=frame.pos, group=t.molecules[0]
  const spheres=group.children.filter(c=>c.geometry?.type==='SphereGeometry')
  if(spheres.length!==pos.length) return
  let cx=0,cy=0,cz=0
  pos.forEach(p=>{cx+=p[0];cy+=p[1];cz+=p[2]})
  cx/=pos.length;cy/=pos.length;cz/=pos.length
  spheres.forEach((m,i)=>m.position.set(pos[i][0]-cx,pos[i][1]-cy,pos[i][2]-cz))
  const cylinders=group.children.filter(c=>c.geometry?.type==='CylinderGeometry')
  let bi=0
  for(let i=0;i<pos.length&&bi<cylinders.length;i++){
    for(let j=i+1;j<pos.length&&bi<cylinders.length;j++){
      const [x1,y1,z1]=pos[i],[x2,y2,z2]=pos[j]
      const d=Math.sqrt((x2-x1)**2+(y2-y1)**2+(z2-z1)**2)
      if(d<2.0){
        const b=cylinders[bi++]
        b.position.set((x1+x2)/2-cx,(y1+y2)/2-cy,(z1+z2)/2-cz)
        b.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(x2-x1,y2-y1,z2-z1).normalize())
        b.scale.y=d/(b.geometry.parameters.height||1)
      }
    }
  }
}

function threeApplyStyle(molecules, style) {
  molecules.forEach(g=>g.children.forEach(c=>{
    if(!c.material) return
    if(c.geometry?.type==='SphereGeometry'){
      c.material.wireframe=style==='wireframe'
      c.scale.setScalar(style==='spacefill'?2.4:1.0)
      c.visible=true
    }
    if(c.geometry?.type==='CylinderGeometry'){
      c.visible=style!=='spacefill'
      c.material.wireframe=style==='wireframe'
    }
  }))
}

// ── MOL VIEWER COMPONENT ──────────────────────────────────

const MolViewer = forwardRef(function MolViewer({ running, fpsCap, atomStyle, onFps }, ref) {
  const canvasRef = useRef(null)
  const areaRef   = useRef(null)
  const t = useRef({ scene:null,camera:null,renderer:null,molecules:[],animFrame:null,
    ircFrames:null,ircPlayback:false,running:false,fpsCap:60,_lastFrame:0 })

  useEffect(()=>{ t.current.running=running },[running])
  useEffect(()=>{ t.current.fpsCap=fpsCap },[fpsCap])
  useEffect(()=>{ threeApplyStyle(t.current.molecules,atomStyle) },[atomStyle])

  useEffect(()=>{
    const canvas=canvasRef.current, area=areaRef.current
    if(!canvas||!area) return
    const W=area.clientWidth,H=area.clientHeight

    t.current.scene=new THREE.Scene()
    t.current.camera=new THREE.PerspectiveCamera(60,W/H,0.1,1000)
    t.current.camera.position.set(0,0,12)
    t.current.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true})
    t.current.renderer.setSize(W,H)
    t.current.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
    t.current.renderer.setClearColor(0xffffff, 1)
    t.current.renderer.shadowMap.enabled = true

    // Rowan-style lighting: bright ambient + two directional for depth
    const amb=new THREE.AmbientLight(0xffffff, 0.85); t.current.scene.add(amb)
    const dir1=new THREE.DirectionalLight(0xffffff, 0.9); dir1.position.set(6,10,8); dir1.castShadow=true; t.current.scene.add(dir1)
    const dir2=new THREE.DirectionalLight(0xffffff, 0.3); dir2.position.set(-6,-4,-6); t.current.scene.add(dir2)
    const fill=new THREE.DirectionalLight(0xeef4ff, 0.2); fill.position.set(0,0,10); t.current.scene.add(fill)

    let drag=false,px=0,py=0
    canvas.addEventListener('mousedown',e=>{drag=true;px=e.clientX;py=e.clientY})
    const up=()=>drag=false
    const move=e=>{
      if(!drag||!t.current.molecules.length) return
      t.current.molecules.forEach(m=>{m.rotation.y+=(e.clientX-px)*0.01;m.rotation.x+=(e.clientY-py)*0.01})
      px=e.clientX;py=e.clientY
    }
    window.addEventListener('mouseup',up)
    window.addEventListener('mousemove',move)
    canvas.addEventListener('wheel',e=>{
      t.current.camera.position.z=Math.max(4,Math.min(20,t.current.camera.position.z+e.deltaY*0.01))
    })
    let lt=null
    canvas.addEventListener('touchstart',e=>{lt=e.touches[0]})
    canvas.addEventListener('touchmove',e=>{
      if(!lt||!t.current.molecules.length) return
      const tc=e.touches[0]
      t.current.molecules.forEach(m=>{m.rotation.y+=(tc.clientX-lt.clientX)*0.012;m.rotation.x+=(tc.clientY-lt.clientY)*0.012})
      lt=tc;e.preventDefault()
    },{passive:false})

    const onResize=()=>{
      const W=area.clientWidth,H=area.clientHeight
      if(!t.current.renderer) return
      t.current.camera.aspect=W/H
      t.current.camera.updateProjectionMatrix()
      t.current.renderer.setSize(W,H)
    }
    window.addEventListener('resize',onResize)

    let fc=0,fpsT=performance.now()
    const animate=()=>{
      t.current.animFrame=requestAnimationFrame(animate)
      if(t.current.fpsCap>0){
        const now=performance.now()
        if(now-t.current._lastFrame<1000/t.current.fpsCap) return
        t.current._lastFrame=now
      }
      const time=Date.now()*0.001
      if(t.current.molecules.length&&!t.current.running&&!t.current.ircPlayback)
        t.current.molecules.forEach(m=>{m.rotation.y+=0.004})
      if(t.current.ircFrames?.length&&t.current.ircPlayback)
        threeUpdateIRC(t.current,t.current.ircFrames[Math.floor(time*6)%t.current.ircFrames.length])
      t.current.renderer.render(t.current.scene,t.current.camera)
      fc++
      const now=performance.now()
      if(now-fpsT>1000){fc=0;fpsT=now}
    }
    animate()

    return ()=>{
      cancelAnimationFrame(t.current.animFrame)
      window.removeEventListener('mouseup',up)
      window.removeEventListener('mousemove',move)
      window.removeEventListener('resize',onResize)
      t.current.renderer.dispose()
    }
  },[])

  useImperativeHandle(ref,()=>({
    showDemo:()=>{
      threeClear(t.current)
      const g=threeBuild(C60_SYMBOLS, C60_POSITIONS)
      t.current.scene.add(g); t.current.molecules.push(g)
    },
    setIRC:(frames,symbols)=>{
      threeClear(t.current)
      t.current.ircFrames=frames; t.current.ircPlayback=frames?.length>0
      if(frames?.length&&symbols?.length&&frames[0]?.pos){
        const g=threeBuildFromPositions(symbols,frames[0].pos)
        t.current.scene.add(g); t.current.molecules.push(g)
        threeApplyStyle(t.current.molecules,'ball-stick')
      }
    },
    clearAll:()=>{ threeClear(t.current); t.current.ircFrames=null; t.current.ircPlayback=false },
    resetView:()=>{ t.current.camera.position.set(0,0,12); t.current.molecules.forEach(m=>m.rotation.set(0,0,0)) },
    fullscreen:()=>{ const a=areaRef.current; !document.fullscreenElement?a?.requestFullscreen?.():document.exitFullscreen?.() },
    hasMol:()=>t.current.molecules.length>0,
  }))

  return (
    <div ref={areaRef} style={{position:'relative',flex:1,background:'#080808',minHeight:0,minWidth:0}}>
      <canvas ref={canvasRef} style={{width:'100%',height:'100%',display:'block'}} />
    </div>
  )
})

function threeBuildFromPositions(symbols, positions) { return threeBuildWork(symbols, positions) }

function threeBuildWork(s,p) {
  const group = new THREE.Group()
  let cx=0,cy=0,cz=0
  p.forEach(pt=>{cx+=pt[0];cy+=pt[1];cz+=pt[2]})
  cx/=p.length;cy/=p.length;cz/=p.length
  s.forEach((sym,i)=>{
    const color=ATOM_COLORS[sym]??ATOM_COLORS.default
    const r=(ATOM_RADII[sym]??ATOM_RADII.default)*1.8
    const mesh=new THREE.Mesh(
      new THREE.SphereGeometry(r,20,16),
      new THREE.MeshStandardMaterial({color,metalness:0.05,roughness:0.35,emissive:0x000000,emissiveIntensity:0})
    )
    mesh.position.set(p[i][0]-cx,p[i][1]-cy,p[i][2]-cz)
    group.add(mesh)
  })
  for(let i=0;i<p.length;i++) for(let j=i+1;j<p.length;j++){
    const [x1,y1,z1]=p[i],[x2,y2,z2]=p[j]
    const d=Math.sqrt((x2-x1)**2+(y2-y1)**2+(z2-z1)**2)
    if(d<2.0&&!(s[i]==='H'&&s[j]==='H')){
      const bond=new THREE.Mesh(
        new THREE.CylinderGeometry(0.06,0.06,d,8),
        new THREE.MeshStandardMaterial({color:0x888880,roughness:0.6})
      )
      bond.position.set((x1+x2)/2-cx,(y1+y2)/2-cy,(z1+z2)/2-cz)
      bond.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(x2-x1,y2-y1,z2-z1).normalize())
      group.add(bond)
    }
  }
  return group
}

// ── ENERGY / IRC CHARTS ───────────────────────────────────

function EnergyProfileChart({ energyProfile }) {
  if(!energyProfile?.length) return null
  const W=460,H=200,p={t:20,r:20,b:36,l:56}
  const iW=W-p.l-p.r,iH=H-p.t-p.b
  const vals=energyProfile.map(pt=>pt.e)
  const minE=Math.min(...vals)-3,maxE=Math.max(...vals)+5
  const rng=maxE-minE||1
  const tx=i=>energyProfile.length>1?p.l+(i/(energyProfile.length-1))*iW:p.l+iW/2
  const ty=e=>p.t+(1-(e-minE)/rng)*iH
  const pts=energyProfile.map((pt,i)=>({x:tx(i),y:ty(pt.e)}))
  const path=pts.map((pt,i)=>{
    if(i===0) return `M${pt.x},${pt.y}`
    const prev=pts[i-1],cpx=(prev.x+pt.x)/2
    return `C${cpx},${prev.y} ${cpx},${pt.y} ${pt.x},${pt.y}`
  }).join(' ')
  const gridVals=[...new Set([-20,-15,-10,-5,0,5,10,15,20,25,30,35].filter(v=>v>=minE&&v<=maxE))]
  return (
    <svg width={W} height={H} style={{overflow:'visible',maxWidth:'100%'}}>
      {gridVals.map(v=>(
        <g key={v}>
          <line x1={p.l} y1={ty(v)} x2={p.l+iW} y2={ty(v)} stroke="var(--border2)" strokeWidth={0.5}/>
          <text x={p.l-5} y={ty(v)+3.5} textAnchor="end" fontFamily="Space Mono,monospace" fontSize={8} fill="var(--text-dim)">{v}</text>
        </g>
      ))}
      <line x1={p.l} y1={ty(0)} x2={p.l+iW} y2={ty(0)} stroke="var(--border)" strokeWidth={1} strokeDasharray="4,3"/>
      <path d={path+` L${pts[pts.length-1].x},${p.t+iH} L${pts[0].x},${p.t+iH}Z`} fill="var(--accent)" fillOpacity={0.07}/>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2}/>
      {energyProfile.map((pt,i)=>(
        <g key={i}>
          <circle cx={tx(i)} cy={ty(pt.e)} r={pt.ts?6:4}
            fill={pt.ts?'var(--accent)':'var(--surface2)'}
            stroke={pt.ts?'var(--accent)':'var(--border)'} strokeWidth={1.5}/>
          <text x={tx(i)} y={ty(pt.e)-11} textAnchor="middle" fontFamily="Space Mono,monospace" fontSize={9}
            fill={pt.ts?'var(--accent)':'var(--text-dim)'}>{pt.label}</text>
          <text x={tx(i)} y={ty(pt.e)+(pt.ts?22:19)} textAnchor="middle" fontFamily="Space Mono,monospace" fontSize={8} fill="var(--text-dim)">
            {pt.e>=0?'+':''}{pt.e.toFixed(1)}
          </text>
        </g>
      ))}
      <text transform={`translate(11,${p.t+iH/2})rotate(-90)`} textAnchor="middle" fontFamily="Space Mono,monospace" fontSize={8} fill="var(--text-dim)" letterSpacing="0.06em">kcal/mol</text>
    </svg>
  )
}

function IrcEnergyChart({ ircFrames }) {
  if(!ircFrames?.length) return null
  const W=460,H=120,p={t:10,r:20,b:28,l:56}
  const iW=W-p.l-p.r,iH=H-p.t-p.b
  const vals=ircFrames.map(f=>f.e_kcal_rel_ts)
  const minE=Math.min(...vals)-1,maxE=Math.max(...vals)+1
  const rng=maxE-minE||1
  const tx=i=>ircFrames.length>1?p.l+(i/(ircFrames.length-1))*iW:p.l+iW/2
  const ty=e=>p.t+(1-(e-minE)/rng)*iH
  const path=ircFrames.map((f,i)=>`${i===0?'M':'L'}${tx(i)},${ty(f.e_kcal_rel_ts)}`).join(' ')
  const mid=Math.floor(ircFrames.length/2)
  return (
    <svg width={W} height={H} style={{overflow:'visible',maxWidth:'100%'}}>
      <line x1={p.l} y1={ty(0)} x2={p.l+iW} y2={ty(0)} stroke="var(--border)" strokeWidth={0.5} strokeDasharray="3,3"/>
      <path d={path+` L${tx(ircFrames.length-1)},${p.t+iH} L${p.l},${p.t+iH}Z`} fill="var(--accent2)" fillOpacity={0.07}/>
      <path d={path} fill="none" stroke="var(--accent2)" strokeWidth={1.5}/>
      <circle cx={tx(mid)} cy={ty(ircFrames[mid].e_kcal_rel_ts)} r={4} fill="var(--accent)"/>
      <text x={p.l} y={H-4} fontFamily="Space Mono,monospace" fontSize={8} fill="var(--text-dim)">← Reactant</text>
      <text x={p.l+iW} y={H-4} textAnchor="end" fontFamily="Space Mono,monospace" fontSize={8} fill="var(--text-dim)">Product →</text>
      <text x={p.l-5} y={ty(vals[mid])+3} textAnchor="end" fontFamily="Space Mono,monospace" fontSize={8} fill="var(--text-dim)">E rel TS</text>
    </svg>
  )
}

// ── LIBRARY THUMB ─────────────────────────────────────────

function LibThumb({ seed }) {
  const ref = useRef(null)
  useEffect(()=>{
    const c=ref.current; if(!c) return
    const ctx=c.getContext('2d'),W=c.width,H=c.height
    const rng=s=>{s=Math.sin(s*127.1+seed*311.7)*43758.5453;return s-Math.floor(s)}
    ctx.fillStyle='#080808'; ctx.fillRect(0,0,W,H)
    const cx=W/2,cy=H/2,n=4+Math.floor(rng(1)*4),atoms=[]
    for(let i=0;i<n;i++){
      const a=(i/n)*Math.PI*2+rng(i)*0.8,r=20+rng(i+10)*30
      atoms.push({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r})
    }
    atoms.push({x:cx,y:cy})
    ctx.strokeStyle='rgba(200,184,154,0.25)'; ctx.lineWidth=1
    for(let i=0;i<n;i++){
      ctx.beginPath();ctx.moveTo(atoms[i].x,atoms[i].y);ctx.lineTo(atoms[n].x,atoms[n].y);ctx.stroke()
      if(i<n-1&&rng(i+20)>0.4){ctx.beginPath();ctx.moveTo(atoms[i].x,atoms[i].y);ctx.lineTo(atoms[i+1].x,atoms[i+1].y);ctx.stroke()}
    }
    const cols=['#888','#eee','#e44','#48e','#c60','#4c4']
    atoms.forEach((pt,i)=>{
      ctx.beginPath();ctx.arc(pt.x,pt.y,i===n?6:3+rng(i+30)*4,0,Math.PI*2)
      ctx.fillStyle=cols[Math.floor(rng(i+40)*cols.length)];ctx.fill()
    })
  },[seed])
  return <canvas ref={ref} width={200} height={140} style={{width:'100%',height:'100%',opacity:0.7}}/>
}

// ── SHARED STYLE HELPERS ──────────────────────────────────

const mono = { fontFamily:'Space Mono,monospace' }
const serif = { fontFamily:'Bodoni Moda,serif' }
const sans = { fontFamily:'Space Grotesk,sans-serif' }

// ── SIDEBAR ───────────────────────────────────────────────

function Sidebar({ page, setPage, open, setOpen, onNewExperiment }) {
  const items=[{id:'dashboard',label:'Dashboard'},{id:'library',label:'Library'},{id:'settings',label:'Settings'}]
  const icons={
    dashboard:<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" style={{width:14,height:14}}><rect x="1" y="1" width="5" height="5"/><rect x="8" y="1" width="5" height="5"/><rect x="1" y="8" width="5" height="5"/><rect x="8" y="8" width="5" height="5"/></svg>,
    library:<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" style={{width:14,height:14}}><rect x="1" y="1" width="12" height="12"/><line x1="1" y1="5" x2="13" y2="5"/><line x1="1" y1="9" x2="13" y2="9"/></svg>,
    settings:<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" style={{width:14,height:14}}><circle cx="7" cy="7" r="2"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.9 2.9l1.1 1.1M10 10l1.1 1.1M2.9 11.1L4 10M10 4l1.1-1.1"/></svg>,
  }
  return (
    <>
      {open && <div onClick={()=>setOpen(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:99,backdropFilter:'blur(2px)'}}/>}
      <aside style={{
        width:200,background:'var(--surface)',borderRight:'1px solid var(--border)',
        display:'flex',flexDirection:'column',flexShrink:0,zIndex:100,
        ...(window.innerWidth<=768?{position:'fixed',top:0,left:0,bottom:0,transform:open?'translateX(0)':'translateX(-100%)',transition:'transform 0.3s cubic-bezier(0.4,0,0.2,1)'}:{})
      }}>
        <div style={{padding:'20px 20px 16px',borderBottom:'1px solid var(--border)'}}>
          <div style={{...serif,fontSize:15,fontStyle:'italic',letterSpacing:'0.02em'}}>MolSim</div>
          <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.12em',textTransform:'uppercase',marginTop:2}}>Molecular Dynamics Engine</div>
        </div>
        <div style={{padding:'14px 16px',borderBottom:'1px solid var(--border2)',display:'flex',alignItems:'center',gap:8}}>
          <div style={{width:22,height:22,background:'var(--border)',display:'flex',alignItems:'center',justifyContent:'center',...mono,fontSize:9,color:'var(--text-mid)',flexShrink:0}}>A</div>
          <div>
            <div style={{fontSize:11,fontWeight:500,color:'var(--text)'}}>Laboratory Alpha</div>
            <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.08em',textTransform:'uppercase'}}>Curated Collection</div>
          </div>
        </div>
        <nav style={{flex:1,padding:'12px 0'}}>
          {items.map(it=>(
            <div key={it.id} onClick={()=>{setPage(it.id);setOpen(false)}} style={{
              display:'flex',alignItems:'center',gap:10,padding:'9px 20px',cursor:'pointer',
              ...mono,fontSize:11,fontWeight:500,letterSpacing:'0.06em',textTransform:'uppercase',
              color:page===it.id?'var(--text)':'var(--text-dim)',
              borderLeft:page===it.id?'2px solid var(--accent)':'2px solid transparent',
              background:page===it.id?'var(--surface2)':'transparent',
              transition:'color 0.15s,background 0.15s',
            }}>
              <span style={{opacity:page===it.id?1:0.6}}>{icons[it.id]}</span>
              {it.label}
            </div>
          ))}
        </nav>
        <div style={{padding:'16px 0',borderTop:'1px solid var(--border)'}}>
          <button onClick={onNewExperiment} style={{
            margin:'0 16px 12px',padding:'9px 12px',background:'var(--text)',color:'var(--bg)',
            border:'none',cursor:'pointer',...sans,fontSize:10,fontWeight:600,
            letterSpacing:'0.08em',textTransform:'uppercase',width:'calc(100% - 32px)',transition:'opacity 0.15s',
          }}>+ New Experiment</button>
        </div>
      </aside>
    </>
  )
}

// ── HEADER ────────────────────────────────────────────────

function Header({ sessionId, page, setPage, setSidebarOpen }) {
  const titles={dashboard:'Reaction Simulation Console',library:'The Project Library',settings:'Preferences & Control'}
  return (
    <header style={{
      height:56,borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',
      padding:'0 28px',gap:20,flexShrink:0,background:'var(--surface)',
    }}>
      <button onClick={()=>setSidebarOpen(o=>!o)} style={{
        display:'none',flexDirection:'column',gap:4,cursor:'pointer',padding:4,
        background:'none',border:'none',
        ...(window.innerWidth<=768?{display:'flex'}:{})
      }}>
        {[0,1,2].map(i=><span key={i} style={{display:'block',width:18,height:1,background:'var(--text-mid)'}}/>)}
      </button>
      <div style={{display:'flex',flexDirection:'column',gap:2,flex:1,minWidth:0}}>
        <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.1em',textTransform:'uppercase'}}>SESSION ID: {sessionId}</div>
        <div style={{...serif,fontSize:20,fontStyle:'italic',color:'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{titles[page]||''}</div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:12,marginLeft:'auto'}}>
        {['⌕','⚙','?'].map((icon,i)=>(
          <div key={i} onClick={i===1?()=>setPage('settings'):undefined} style={{
            width:28,height:28,border:'1px solid var(--border)',display:'flex',alignItems:'center',
            justifyContent:'center',cursor:'pointer',color:'var(--text-dim)',fontSize:12,
            transition:'border-color 0.15s,color 0.15s',
          }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--text)'}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text-dim)'}}
          >{icon}</div>
        ))}
        <div style={{width:28,height:28,background:'var(--surface2)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'var(--text-mid)',fontWeight:600,cursor:'pointer'}}>U</div>
      </div>
    </header>
  )
}

// ── DASHBOARD ─────────────────────────────────────────────

function DashboardPage(props) {
  const { tab, setTab, ...rest } = props
  return (
    <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}}>
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',background:'var(--surface)',flexShrink:0}}>
        {['simulation','analytics'].map(t=>(
          <div key={t} onClick={()=>setTab(t)} style={{
            padding:'14px 24px',cursor:'pointer',fontSize:11,fontWeight:500,
            letterSpacing:'0.06em',textTransform:'uppercase',...mono,
            color:tab===t?'var(--text)':'var(--text-dim)',
            borderBottom:tab===t?'2px solid var(--accent)':'2px solid transparent',
            transition:'color 0.15s,border-color 0.15s',
          }}>{t.charAt(0).toUpperCase()+t.slice(1)}</div>
        ))}
      </div>
      <div style={{flex:1,overflow:'hidden',display:'flex'}}>
        <div style={{display:tab==='simulation'?'flex':'none',flex:1,overflow:'hidden'}}>
          <SimulationTab {...rest}/>
        </div>
        <div style={{display:tab==='analytics'?'flex':'none',flex:1,overflow:'hidden'}}>
          <AnalyticsTab energyProfile={rest.energyProfile} ircFrames={rest.ircFrames} s4={rest.s4} pipeResult={rest.pipeResult}/>
        </div>
      </div>
    </div>
  )
}

// ── SIMULATION TAB ────────────────────────────────────────

function SimulationTab({ mode, setMode, solvent, setSolvent, temp, setTemp,
  prompt, setPrompt, pipeStatus, pipeSteps, pipeLogs, logBodyRef, elapsedSec,
  viewerRef, barrier, rxnVal, rateStr, rateUnits, ircFrames, energyMethod,
  saddleFound, pipeResult, s4, onRun, onCancel, settings }) {

  const [showMetrics, setShowMetrics] = useState(false)
  const running = pipeStatus === 'running'
  const isMobile = window.innerWidth <= 768

  const MetricsPanel = () => (
    <div style={{background:'var(--surface)',display:'flex',flexDirection:'column',
      ...(isMobile
        ? {borderTop:'1px solid var(--border)',overflowY:'auto',maxHeight:'50vh'}
        : {width:220,borderLeft:'1px solid var(--border)',overflowY:'auto',flexShrink:0})
    }}>
      <div style={{padding:'16px 16px 12px',borderBottom:'1px solid var(--border2)',...serif,fontSize:14,fontStyle:'italic',color:'var(--text)'}}>Simulation Metrics</div>
      <div style={{padding:'14px 16px',borderBottom:'1px solid var(--border2)'}}>
        {[
          {key:'ΔG‡',val:barrier!=null?`${barrier} kcal/mol`:null},
          {key:'ΔG rxn',val:rxnVal!=null?`${rxnVal} kcal/mol`:null},
          {key:'Rate k',val:rateStr?`${rateStr} ${rateUnits}`:null},
          {key:'Solvent',val:solvent||null},
          {key:'IRC Frames',val:ircFrames?.length?`${ircFrames.length} frames`:null},
        ].map(({key,val})=>(
          <div key={key} style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'6px 0',borderBottom:'1px solid var(--border2)'}}>
            <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.06em',textTransform:'uppercase'}}>{key}</div>
            <div style={{...mono,fontSize:key==='ΔG‡'||key==='ΔG rxn'?13:11,color:val?'var(--text)':'var(--text-dim)',textAlign:'right',maxWidth:130,wordBreak:'break-all'}}>
              {val||'—'}
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:'14px 16px',borderBottom:'1px solid var(--border2)'}}>
        <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.12em',textTransform:'uppercase',marginBottom:8}}>Method</div>
        <div style={{...mono,fontSize:8,padding:'2px 6px',letterSpacing:'0.06em',
          ...(pipeStatus==='idle'?{background:'var(--surface2)',color:'var(--text-dim)',border:'1px solid var(--border)'}
            :mode==='accurate'?{background:'#2a2a3d',color:'#7a8ab8',border:'1px solid #3a3a5d'}
            :{background:'var(--green-dim)',color:'#5a9',border:'1px solid var(--green)'}),
        }}>
          {pipeStatus==='idle'?'Awaiting run':pipeStatus==='running'?'Computing…':energyMethod}
        </div>
        {pipeStatus==='running'&&<div style={{...mono,fontSize:8,color:'var(--text-dim)',marginTop:8,letterSpacing:'0.06em'}}>Polling every 3s…</div>}
        {s4?.is_bimolecular&&s4?.t_ds_correction_kcal&&(
          <div style={{...mono,fontSize:8,color:'var(--accent2)',marginTop:6}}>−TΔS‡ +{s4.t_ds_correction_kcal} kcal/mol applied</div>
        )}
        {pipeResult&&!saddleFound&&(
          <div style={{...mono,fontSize:8,color:'#c06060',marginTop:6,letterSpacing:'0.06em'}}>No saddle point found</div>
        )}
      </div>
      {pipeResult&&(s4?.extra?.narrative||pipeResult.summary)&&(
        <div style={{margin:'14px 16px',padding:12,background:'var(--surface2)',border:'1px solid var(--border2)',borderLeft:'2px solid var(--accent)'}}>
          <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:6}}>Archival Note</div>
          <div style={{...serif,fontStyle:'italic',fontSize:11,color:'var(--text-mid)',lineHeight:1.6}}>{s4?.extra?.narrative||pipeResult.summary}</div>
        </div>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <div style={{display:'flex',flexDirection:'column',height:'100dvh',overflow:'hidden'}}>

        {/* ── MOBILE CONFIG ROW ── */}
        <div style={{borderBottom:'1px solid var(--border)',background:'var(--surface)',flexShrink:0,overflowX:'auto'}}>
          <div style={{display:'flex',gap:0,minWidth:'max-content'}}>
            {/* Mode */}
            <div style={{padding:'10px 14px',borderRight:'1px solid var(--border)'}}>
              <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:6}}>Mode</div>
              <div style={{display:'flex',border:'1px solid var(--border)',overflow:'hidden'}}>
                {['fast','accurate'].map(m=>(
                  <button key={m} onClick={()=>setMode(m)} style={{
                    padding:'5px 10px',cursor:'pointer',fontSize:9,fontWeight:500,...sans,border:'none',
                    background:mode===m?'var(--text)':'transparent',
                    color:mode===m?'var(--bg)':'var(--text-dim)',transition:'background 0.15s,color 0.15s',
                  }}>{m.charAt(0).toUpperCase()+m.slice(1)}</button>
                ))}
              </div>
            </div>
            {/* Temp */}
            <div style={{padding:'10px 14px',borderRight:'1px solid var(--border)'}}>
              <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:6}}>Temp</div>
              <div style={{display:'flex',alignItems:'center',border:'1px solid var(--border)',background:'var(--surface2)',overflow:'hidden',width:100}}>
                <input type="number" value={temp} onChange={e=>setTemp(parseFloat(e.target.value)||300)}
                  min={100} max={1000} step={10} style={{
                    flex:1,background:'transparent',border:'none',padding:'5px 8px',
                    color:'var(--text)',...mono,fontSize:11,outline:'none',width:60,
                  }}/>
                <div style={{padding:'0 7px',...mono,fontSize:9,color:'var(--text-dim)',borderLeft:'1px solid var(--border)'}}>K</div>
              </div>
            </div>
            {/* Solvent */}
            <div style={{padding:'10px 14px',borderRight:'1px solid var(--border)'}}>
              <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:6}}>Solvent</div>
              <div style={{position:'relative'}}>
                <select value={solvent} onChange={e=>setSolvent(e.target.value)} style={{
                  background:'var(--surface2)',border:'1px solid var(--border)',
                  color:'var(--text)',padding:'5px 24px 5px 8px',...mono,fontSize:10,outline:'none',
                  cursor:'pointer',appearance:'none',WebkitAppearance:'none',
                }}>
                  {SOLVENTS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <span style={{position:'absolute',right:7,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)',fontSize:9,pointerEvents:'none'}}>▾</span>
              </div>
            </div>
            {/* Pipeline progress (compact) */}
            {pipeSteps.length>0&&(
              <div style={{padding:'10px 14px',minWidth:140}}>
                <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:6}}>
                  Pipeline {running?`· ${Math.floor(elapsedSec/60).toString().padStart(2,'0')}:${(elapsedSec%60).toString().padStart(2,'0')}` : ''}
                </div>
                {pipeSteps.map((step,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                    <div style={{flex:1,height:2,background:'var(--border)',overflow:'hidden'}}>
                      <div style={{height:'100%',background:step.error?'var(--red)':'var(--accent)',width:step.done?'100%':'0%',transition:step.done?'width 0.5s ease-out':'none',animation:step.active?'slideIndeterminate 1.8s ease-in-out infinite':'none'}}/>
                    </div>
                    <div style={{...mono,fontSize:8,color:step.done?(step.error?'#c06060':'#5a9'):'var(--text-dim)',width:10,textAlign:'center'}}>
                      {step.done?(step.error?'✗':'✓'):(step.active?'…':'·')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── VIEWER ── */}
        <div style={{position:'relative',background:'#ffffff',flex:1,minHeight:0,maxHeight:'calc(100dvh - 230px)'}}>
          <MolViewer ref={viewerRef} running={running} fpsCap={60} atomStyle="ball-stick"/>
          {!viewerRef.current?.hasMol?.() && pipeStatus==='idle' && (
            <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,pointerEvents:'none'}}>
              <div style={{fontSize:32,opacity:0.08}}>⬡</div>
              <div style={{...serif,fontStyle:'italic',fontSize:13,color:'var(--text-dim)',opacity:0.5}}>No simulation active</div>
            </div>
          )}
          {pipeStatus==='idle'&&viewerRef.current?.hasMol?.()&&(
            <div style={{position:'absolute',bottom:46,left:0,right:0,display:'flex',justifyContent:'center',pointerEvents:'none'}}>
              <div style={{background:'rgba(255,255,255,0.92)',border:'1px solid var(--border)',padding:'4px 12px',display:'flex',flexDirection:'column',alignItems:'center',gap:1,backdropFilter:'blur(8px)'}}>
                <div style={{...serif,fontStyle:'italic',fontSize:11,color:'var(--text)',letterSpacing:'0.02em'}}>Buckminsterfullerene</div>
                <div style={{...mono,fontSize:7,color:'var(--text-dim)',letterSpacing:'0.12em'}}>C₆₀ · DEMO MOLECULE</div>
              </div>
            </div>
          )}
          <div style={{position:'absolute',top:10,left:10,display:'flex',gap:6,alignItems:'center'}}>
            <div style={{display:'flex',alignItems:'center',gap:4,background:'rgba(255,255,255,0.9)',border:'1px solid var(--border)',padding:'3px 8px',...mono,fontSize:8,color:'var(--text-mid)',backdropFilter:'blur(8px)'}}>
              <div style={{width:4,height:4,borderRadius:'50%',background:running?'#4a7':'var(--text-dim)',animation:running?'pulse 1.2s ease-in-out infinite':'none'}}/>
              {running?'LIVE':pipeStatus==='complete'?'COMPLETE':'IDLE'}
            </div>
          </div>
          {pipeStatus==='idle'&&viewerRef.current?.hasMol?.()&&(
            <div style={{position:'absolute',bottom:14,left:'50%',transform:'translateX(-50%)',pointerEvents:'none'}}>
              <div style={{background:'rgba(255,255,255,0.92)',border:'1px solid var(--border)',padding:'5px 16px',display:'flex',flexDirection:'column',alignItems:'center',gap:1,backdropFilter:'blur(8px)'}}>
                <div style={{...serif,fontStyle:'italic',fontSize:13,color:'var(--text)',letterSpacing:'0.02em'}}>Buckminsterfullerene</div>
                <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.12em'}}>C₆₀ · DEMO MOLECULE</div>
              </div>
            </div>
          )}
          <div style={{position:'absolute',bottom:10,right:10,display:'flex',gap:6}}>
            {[{icon:'↺',fn:()=>viewerRef.current?.resetView()},{icon:'⤢',fn:()=>viewerRef.current?.fullscreen()}].map(b=>(
              <div key={b.icon} onClick={b.fn} style={{width:28,height:28,background:'rgba(255,255,255,0.9)',border:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--text-dim)',fontSize:11,backdropFilter:'blur(8px)'}}>{b.icon}</div>
            ))}
          </div>
        </div>

        {/* ── LOGS (always visible) ── */}
        <div style={{height:running?90:55,borderTop:'1px solid var(--border)',background:'var(--surface)',display:'flex',flexDirection:'column',flexShrink:0,transition:'height 0.3s ease'}}>
          {running && (
            <div style={{padding:'4px 12px',borderBottom:'1px solid var(--border2)',display:'flex',gap:6,alignItems:'center',flexShrink:0}}>
              {pipeSteps.map((step,i)=>(
                <div key={i} style={{flex:1,display:'flex',flexDirection:'column',gap:2,alignItems:'center'}}>
                  <div style={{width:'100%',height:3,background:'var(--border)',overflow:'hidden',borderRadius:1}}>
                    <div style={{
                      height:'100%',borderRadius:1,
                      background:step.error?'var(--red)':step.done?'var(--accent)':'var(--accent)',
                      width:step.done?'100%':step.active?'40%':'0%',
                      opacity:1,
                      transition:step.done?'width 0.5s ease-out':'none',
                      animation:step.active?'slideIndeterminate 1.8s ease-in-out infinite':'none',
                    }}/>
                  </div>
                  <div style={{...mono,fontSize:7,color:step.done?'#5a9':step.active?'var(--accent)':'var(--text-dim)',letterSpacing:'0.04em',textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',maxWidth:'100%',textOverflow:'ellipsis'}}>
                    {step.active?'▶ '+step.name.split(' ')[0]:step.done?(step.error?'✗':'✓'):step.name.split(' ')[0]}
                  </div>
                </div>
              ))}
              <div style={{...mono,fontSize:8,color:'var(--text-dim)',flexShrink:0,paddingLeft:6,borderLeft:'1px solid var(--border2)'}}>
                {Math.floor(elapsedSec/60).toString().padStart(2,'0')}:{(elapsedSec%60).toString().padStart(2,'0')}
              </div>
            </div>
          )}
          <div ref={logBodyRef} style={{flex:1,overflowY:'auto',padding:'5px 12px',display:'flex',flexDirection:'column',gap:1}}>
            {pipeLogs.length===0 && (
              <div style={{...mono,fontSize:9,color:'var(--text-dim)',opacity:0.4,padding:'4px 0'}}>Ready — enter a reaction prompt below</div>
            )}
            {pipeLogs.map((log,i)=>(
              <div key={i} style={{display:'flex',gap:6,alignItems:'flex-start',...mono,fontSize:9,lineHeight:1.4}}>
                <span style={{color:'var(--text-dim)',flexShrink:0}}>{log.time}</span>
                <span style={{color:{info:'var(--text-mid)',success:'#5a9',warn:'#b8963a',data:'var(--accent)',error:'#c06060'}[log.type]||'var(--text-mid)'}}>{log.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── PROMPT BAR ── */}
        <div style={{borderTop:'2px solid var(--accent)',padding:'10px 12px',display:'flex',gap:8,alignItems:'flex-end',background:'var(--surface)',flexShrink:0,minHeight:56}}>
          <div style={{flex:1,border:'1px solid var(--border)',background:'var(--surface2)',display:'flex',alignItems:'center',gap:6,padding:'0 10px'}}>
            <span style={{color:'var(--text-dim)',fontSize:10,flexShrink:0}}>⬡</span>
            <textarea value={prompt} onChange={e=>setPrompt(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();onRun()}}}
              onChange={e=>{setPrompt(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,72)+'px'}}
              placeholder="Describe a reaction…"
              rows={1} style={{
                flex:1,background:'transparent',border:'none',padding:'8px 0',
                color:'var(--text)',...sans,fontSize:12,outline:'none',resize:'none',
                minHeight:34,maxHeight:72,overflow:'hidden',
              }}/>
          </div>
          <div style={{display:'flex',gap:6,flexShrink:0}}>
            <button onClick={()=>setShowMetrics(m=>!m)} style={{
              padding:'8px 10px',background:showMetrics?'var(--surface2)':'transparent',
              color:'var(--text-dim)',border:'1px solid var(--border)',cursor:'pointer',fontSize:13,height:36,
            }}>◈</button>
            {running
              ? <button onClick={onCancel} style={{padding:'8px 12px',background:'transparent',color:'#c06060',border:'1px solid #7c4a4a',cursor:'pointer',...sans,fontSize:10,fontWeight:600,letterSpacing:'0.06em',textTransform:'uppercase',height:36,whiteSpace:'nowrap'}}>Stop</button>
              : <button onClick={onRun} disabled={!prompt.trim()} style={{padding:'8px 14px',background:'var(--text)',color:'var(--bg)',border:'none',cursor:prompt.trim()?'pointer':'not-allowed',opacity:prompt.trim()?1:0.4,...sans,fontSize:10,fontWeight:600,letterSpacing:'0.06em',textTransform:'uppercase',height:36,whiteSpace:'nowrap'}}>Run →</button>
            }
          </div>
        </div>

        {/* ── METRICS DRAWER (toggled) ── */}
        {showMetrics && <MetricsPanel/>}
      </div>
    )
  }

  // ── DESKTOP LAYOUT ──────────────────────────────────────
  return (
    <div style={{display:'flex',flex:1,overflow:'hidden'}}>

      {/* LEFT CONFIG */}
      <div style={{width:220,borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',overflowY:'auto',flexShrink:0,background:'var(--surface)'}}>
        <ConfigSection label="Accuracy Mode">
          <div style={{display:'flex',border:'1px solid var(--border)',overflow:'hidden'}}>
            {['fast','accurate'].map(m=>(
              <button key={m} onClick={()=>setMode(m)} style={{
                flex:1,padding:'8px 6px',cursor:'pointer',fontSize:10,fontWeight:500,
                letterSpacing:'0.05em',...sans,border:'none',
                background:mode===m?'var(--text)':'transparent',
                color:mode===m?'var(--bg)':'var(--text-dim)',transition:'background 0.15s,color 0.15s',
              }}>{m.charAt(0).toUpperCase()+m.slice(1)}</button>
            ))}
          </div>
          <div style={{...mono,fontSize:8,color:'var(--text-dim)',marginTop:6,letterSpacing:'0.06em'}}>
            {mode==='fast'?'~2–3 min · MACE energies':'~6–9 min · DFT + Hessian'}
          </div>
        </ConfigSection>

        <ConfigSection label="Temperature">
          <div style={{display:'flex',alignItems:'center',border:'1px solid var(--border)',background:'var(--surface2)',overflow:'hidden'}}>
            <input type="number" value={temp} onChange={e=>setTemp(parseFloat(e.target.value)||300)}
              min={100} max={1000} step={10} style={{
                flex:1,background:'transparent',border:'none',padding:'8px 10px',
                color:'var(--text)',...mono,fontSize:12,outline:'none',
              }}/>
            <div style={{padding:'0 10px',...mono,fontSize:9,color:'var(--text-dim)',borderLeft:'1px solid var(--border)',height:'100%',display:'flex',alignItems:'center'}}>K</div>
          </div>
        </ConfigSection>

        <ConfigSection label="Solvent">
          <div style={{position:'relative'}}>
            <select value={solvent} onChange={e=>setSolvent(e.target.value)} style={{
              width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',
              color:'var(--text)',padding:'8px 10px',...mono,fontSize:11,outline:'none',
              cursor:'pointer',appearance:'none',WebkitAppearance:'none',
            }}>
              {SOLVENTS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <span style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)',fontSize:10,pointerEvents:'none'}}>▾</span>
          </div>
        </ConfigSection>

        {pipeSteps.length>0 && (
          <ConfigSection label="Pipeline Progress">
            {pipeSteps.map((step,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0'}}>
                <div style={{...mono,fontSize:8,color:'var(--text-dim)',width:14,flexShrink:0}}>{String(i+1).padStart(2,'0')}</div>
                <div style={{flex:1,height:2,background:'var(--border)',overflow:'hidden'}}>
                  <div style={{height:'100%',background:step.error?'var(--red)':'var(--accent)',width:step.done?'100%':'0%',transition:step.done?'width 0.5s ease-out':'none',animation:step.active?'slideIndeterminate 1.8s ease-in-out infinite':'none'}}/>
                </div>
                <div style={{...mono,fontSize:8,color:step.done?(step.error?'#c06060':'#5a9'):'var(--text-dim)',width:14,textAlign:'center',flexShrink:0}}>
                  {step.done?(step.error?'✗':'✓'):(step.active?'…':'·')}
                </div>
              </div>
            ))}
            {running && (
              <div style={{...mono,fontSize:8,color:'var(--text-dim)',marginTop:8,letterSpacing:'0.06em'}}>
                {Math.floor(elapsedSec/60).toString().padStart(2,'0')}:{(elapsedSec%60).toString().padStart(2,'0')} elapsed
              </div>
            )}
          </ConfigSection>
        )}
      </div>

      {/* CENTER */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>
        <div style={{flex:1,position:'relative',background:'#080808',minHeight:0}}>
          <MolViewer ref={viewerRef} running={running} fpsCap={60} atomStyle="ball-stick"/>
          {!viewerRef.current?.hasMol?.() && pipeStatus==='idle' && (
            <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,pointerEvents:'none'}}>
              <div style={{fontSize:40,opacity:0.08}}>⬡</div>
              <div style={{...serif,fontStyle:'italic',fontSize:16,color:'var(--text-dim)',opacity:0.5}}>No simulation active</div>
              <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.1em',opacity:0.3}}>Enter a reaction prompt below to begin</div>
            </div>
          )}
          <div style={{position:'absolute',top:16,left:16,display:'flex',gap:8,alignItems:'center'}}>
            <div style={{display:'flex',alignItems:'center',gap:5,background:'rgba(0,0,0,0.7)',border:'1px solid var(--border)',padding:'4px 10px',...mono,fontSize:9,letterSpacing:'0.1em',color:'var(--text-mid)',backdropFilter:'blur(8px)'}}>
              <div style={{width:5,height:5,borderRadius:'50%',background:running?'#4a7':'var(--text-dim)',animation:running?'pulse 1.2s ease-in-out infinite':'none'}}/>
              {running?'LIVE':pipeStatus==='complete'?'COMPLETE':'IDLE'}
            </div>
          </div>
          <div style={{position:'absolute',bottom:16,right:16,display:'flex',gap:8}}>
            {[{icon:'↺',fn:()=>viewerRef.current?.resetView()},{icon:'⤢',fn:()=>viewerRef.current?.fullscreen()}].map(b=>(
              <div key={b.icon} onClick={b.fn} style={{
                width:30,height:30,background:'rgba(0,0,0,0.7)',border:'1px solid var(--border)',
                display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',
                color:'var(--text-dim)',fontSize:12,backdropFilter:'blur(8px)',transition:'color 0.15s,border-color 0.15s',
              }}
              onMouseEnter={e=>{e.currentTarget.style.color='var(--text)';e.currentTarget.style.borderColor='var(--accent)'}}
              onMouseLeave={e=>{e.currentTarget.style.color='var(--text-dim)';e.currentTarget.style.borderColor='var(--border)'}}
              >{b.icon}</div>
            ))}
          </div>
        </div>

        <div style={{height:running?180:120,borderTop:'1px solid var(--border)',background:'var(--surface)',display:'flex',flexDirection:'column',flexShrink:0,transition:'height 0.3s ease'}}>
          <div style={{display:'flex',alignItems:'center',padding:'7px 14px',borderBottom:'1px solid var(--border2)',gap:8,flexShrink:0}}>
            <div style={{...mono,fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--text-dim)',flex:1}}>Laboratory Console</div>
            {running && <div style={{...mono,fontSize:8,color:'var(--accent)',letterSpacing:'0.08em',animation:'pulse 1.5s ease-in-out infinite'}}>● LIVE</div>}
          </div>
          {running && pipeSteps.length>0 && (
            <div style={{display:'flex',gap:4,padding:'8px 14px',borderBottom:'1px solid var(--border2)',flexShrink:0}}>
              {pipeSteps.map((step,i)=>(
                <div key={i} style={{flex:1,display:'flex',flexDirection:'column',gap:3}}>
                  <div style={{width:'100%',height:3,background:'var(--border)',overflow:'hidden',borderRadius:1}}>
                    <div style={{
                      height:'100%',borderRadius:1,
                      background:step.error?'var(--red)':'var(--accent)',
                      width:step.done?'100%':step.active?'65%':'0%',
                      opacity:step.active?0.65:1,
                      transition:'width 0.8s ease-out',
                      animation:step.active?'pulse 1.5s ease-in-out infinite':'none',
                    }}/>
                  </div>
                  <div style={{...mono,fontSize:7,color:step.done?'#5a9':step.active?'var(--accent)':'var(--text-dim)',letterSpacing:'0.04em',textAlign:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {step.active?'▶ '+step.name:step.done?(step.error?'✗ '+step.name:'✓ '+step.name):step.name}
                  </div>
                </div>
              ))}
              <div style={{...mono,fontSize:9,color:'var(--text-dim)',flexShrink:0,paddingLeft:10,borderLeft:'1px solid var(--border2)',display:'flex',alignItems:'center'}}>
                {Math.floor(elapsedSec/60).toString().padStart(2,'0')}:{(elapsedSec%60).toString().padStart(2,'0')}
              </div>
            </div>
          )}
          <div ref={logBodyRef} style={{flex:1,overflowY:'auto',padding:'7px 14px',display:'flex',flexDirection:'column',gap:2}}>
            {pipeLogs.length===0 && (
              <div style={{...mono,fontSize:10,color:'var(--text-dim)',opacity:0.4}}>Ready — enter a reaction prompt below to begin</div>
            )}
            {pipeLogs.map((log,i)=>(
              <div key={i} style={{display:'flex',gap:8,alignItems:'flex-start',...mono,fontSize:10,lineHeight:1.5}}>
                <span style={{color:'var(--text-dim)',flexShrink:0}}>{log.time}</span>
                <span style={{color:{info:'var(--text-mid)',success:'#5a9',warn:'#b8963a',data:'var(--accent)',error:'#c06060'}[log.type]||'var(--text-mid)'}}>{log.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{borderTop:'1px solid var(--border)',padding:'12px 16px',display:'flex',gap:10,alignItems:'flex-end',background:'var(--surface)',flexShrink:0}}>
          <div style={{flex:1,border:'1px solid var(--border)',background:'var(--surface2)',display:'flex',alignItems:'center',gap:8,padding:'0 12px',transition:'border-color 0.15s'}}
            onFocus={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onBlur={e=>e.currentTarget.style.borderColor='var(--border)'}
          >
            <span style={{color:'var(--text-dim)',fontSize:11,flexShrink:0}}>⬡</span>
            <textarea value={prompt} onChange={e=>setPrompt(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();onRun()}}}
              placeholder="Describe a reaction — e.g. SN2 substitution of bromomethane with hydroxide in water"
              rows={1} style={{
                flex:1,background:'transparent',border:'none',padding:'10px 0',
                color:'var(--text)',...sans,fontSize:12,outline:'none',resize:'none',
                minHeight:36,maxHeight:80,
              }}/>
          </div>
          {running
            ? <button onClick={onCancel} style={{padding:'10px 16px',background:'transparent',color:'#c06060',border:'1px solid #7c4a4a',cursor:'pointer',...sans,fontSize:10,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',height:38,whiteSpace:'nowrap'}}>Cancel</button>
            : <button onClick={onRun} disabled={!prompt.trim()} style={{padding:'10px 20px',background:'var(--text)',color:'var(--bg)',border:'none',cursor:prompt.trim()?'pointer':'not-allowed',opacity:prompt.trim()?1:0.4,...sans,fontSize:10,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',height:38,whiteSpace:'nowrap',transition:'opacity 0.15s'}}>Run →</button>
          }
        </div>
      </div>

      {/* RIGHT METRICS */}
      <MetricsPanel/>
    </div>
  )
}

function ConfigSection({ label, children }) {
  return (
    <div style={{padding:'18px 16px',borderBottom:'1px solid var(--border2)'}}>
      <div style={{...mono,fontSize:9,letterSpacing:'0.12em',textTransform:'uppercase',color:'var(--text-dim)',marginBottom:10}}>{label}</div>
      {children}
    </div>
  )
}

// ── ANALYTICS TAB ─────────────────────────────────────────

function AnalyticsTab({ energyProfile, ircFrames, s4, pipeResult }) {
  const hasData = energyProfile?.length > 0
  if (!hasData) return (
    <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16}}>
      <div style={{...serif,fontSize:28,fontStyle:'italic',color:'var(--text)',opacity:0.3}}>Analytics</div>
      <div style={{...mono,fontSize:10,color:'var(--text-dim)',letterSpacing:'0.1em',opacity:0.4}}>RUN A SIMULATION FIRST TO SEE ENERGY PROFILES</div>
    </div>
  )
  return (
    <div style={{flex:1,overflowY:'auto',padding:'32px'}}>
      <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:4}}>Reaction Energy Profile</div>
      <div style={{...serif,fontStyle:'italic',fontSize:22,color:'var(--text)',marginBottom:24}}>{s4?.energy_method||'MACE-OMol-0'}</div>

      <div style={{background:'var(--surface)',border:'1px solid var(--border)',padding:'24px',marginBottom:24}}>
        <EnergyProfileChart energyProfile={energyProfile}/>
        <div style={{display:'flex',gap:24,marginTop:16}}>
          {[
            {k:'ΔG‡ (gas)',v:s4?.delta_g_barrier_gas_kcal!=null?`${s4.delta_g_barrier_gas_kcal.toFixed(2)} kcal/mol`:'—'},
            {k:'ΔG‡ (solvated)',v:s4?.delta_g_barrier_kcal!=null?`${s4.delta_g_barrier_kcal.toFixed(2)} kcal/mol`:'—'},
            {k:'ΔG rxn',v:s4?.delta_g_rxn_kcal!=null?`${s4.delta_g_rxn_kcal.toFixed(2)} kcal/mol`:'—'},
          ].map(({k,v})=>(
            <div key={k}>
              <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>{k}</div>
              <div style={{...mono,fontSize:14,color:'var(--accent)'}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {ircFrames?.length>0&&(
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',padding:'24px',marginBottom:24}}>
          <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:16}}>
            IRC Energy Trace — {ircFrames.length} frames (TS = t=0)
          </div>
          <IrcEnergyChart ircFrames={ircFrames}/>
        </div>
      )}

      {s4&&(
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',padding:'24px'}}>
          <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:16}}>Kinetic Summary</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:16}}>
            {[
              {k:'Rate Constant',v:s4.rate_constant_s1?`${s4.rate_constant_s1} ${s4.rate_constant_units||'s⁻¹'}`:  '—'},
              {k:'Reaction Order',v:s4.is_bimolecular?'Bimolecular (k₂)':'Unimolecular (k₁)'},
              {k:'Entropic Penalty',v:s4.t_ds_correction_kcal?`+${s4.t_ds_correction_kcal} kcal/mol`:'n/a'},
              {k:'DFT Method',v:s4.energy_method||'—'},
              {k:'Saddle Point',v:s4.saddle_point_found!==false?'✓ Found':'✗ Not found'},
              {k:'IRC Frames',v:s4.irc_frame_count?`${s4.irc_frame_count} frames`:'—'},
            ].map(({k,v})=>(
              <div key={k} style={{borderLeft:'1px solid var(--border)',paddingLeft:12}}>
                <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>{k}</div>
                <div style={{...mono,fontSize:11,color:'var(--text)'}}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── LIBRARY PAGE ──────────────────────────────────────────

function LibraryPage({ simulations, onOpen }) {
  const all = [...simulations]
  return (
    <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
      <div style={{padding:'28px 32px 20px',borderBottom:'1px solid var(--border)',flexShrink:0,display:'flex',alignItems:'flex-end',justifyContent:'space-between'}}>
        <div>
          <div style={{...serif,fontSize:32,fontStyle:'italic',color:'var(--text)',lineHeight:1}}>The Project Library</div>
          <div style={{fontSize:12,color:'var(--text-dim)',marginTop:6,maxWidth:420,lineHeight:1.6}}>A curated archival collection of molecular trajectories and structural computations.</div>
        </div>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'24px 32px',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:20,alignContent:'start'}}>
        {all.length===0&&(
          <div style={{gridColumn:'1/-1',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'80px 0',gap:12,opacity:0.5}}>
            <div style={{fontSize:36}}>⬡</div>
            <div style={{...serif,fontStyle:'italic',fontSize:18,color:'var(--text-dim)'}}>No simulations yet</div>
            <div style={{fontSize:11,color:'var(--text-dim)',textAlign:'center',maxWidth:300,lineHeight:1.6}}>Run a reaction from the dashboard and your results will appear here.</div>
          </div>
        )}
        {all.map((item,i)=>(
          <div key={item.id} onClick={()=>onOpen(item)} style={{border:'1px solid var(--border)',background:'var(--surface)',cursor:'pointer',transition:'border-color 0.2s',overflow:'hidden'}}
            onMouseEnter={e=>e.currentTarget.style.borderColor='var(--accent)'}
            onMouseLeave={e=>e.currentTarget.style.borderColor='var(--border)'}
          >
            <div style={{height:140,background:'#080808',position:'relative',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center'}}>
              <LibThumb seed={i}/>
            </div>
            <div style={{padding:'14px 14px 12px'}}>
              <div style={{...mono,fontSize:8,color:'var(--text-dim)',display:'flex',justifyContent:'space-between',marginBottom:5}}>
                <span>FOLDER ID: {item.id}</span><span>{item.status}</span>
              </div>
              <div style={{...serif,fontStyle:'italic',fontSize:14,color:'var(--text)',marginBottom:5,lineHeight:1.3}}>{item.title}</div>
              <div style={{fontSize:10,color:'var(--text-dim)',lineHeight:1.5,marginBottom:10}}>{item.desc}</div>
              <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                {item.tags.map(t=><span key={t} style={{...mono,fontSize:8,padding:'2px 7px',border:'1px solid var(--border)',color:'var(--text-dim)',letterSpacing:'0.06em',textTransform:'uppercase'}}>{t}</span>)}
                <span style={{...mono,fontSize:8,padding:'2px 7px',border:'1px solid',letterSpacing:'0.06em',textTransform:'uppercase',...(item.mode==='accurate'?{borderColor:'#3a3a5d',color:'#7a8ab8'}:{borderColor:'var(--green)',color:'#5a9'})}}>{item.mode}</span>
                <span style={{...mono,fontSize:8,color:'var(--text-dim)',marginLeft:'auto',alignSelf:'center'}}>{item.date}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:'12px 32px',borderTop:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.06em'}}>
          Viewing 01 — {String(all.length).padStart(2,'0')} of {all.length}
        </div>
      </div>
    </div>
  )
}

// ── SETTINGS PAGE ─────────────────────────────────────────

function SettingsPage({ settings, setSettings, mode, setMode }) {
  const [draft, setDraft] = useState(settings)
  const save = () => {
    setSettings(draft)
    localStorage.setItem('molsim_api_url', draft.apiUrl)
    localStorage.setItem('molsim_default_temp', draft.defaultTemp)
    localStorage.setItem('molsim_fps_cap', String(draft.fpsCap))
    localStorage.setItem('molsim_atom_style', draft.atomStyle)
    localStorage.setItem('molsim_mode', mode)
  }
  const field = (label, el) => (
    <div>
      <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:5}}>{label}</div>
      {el}
    </div>
  )
  const input = (val, onChange, type='text', extra={}) => (
    <input type={type} value={val} onChange={e=>onChange(e.target.value)} {...extra} style={{
      width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',color:'var(--text)',
      padding:'9px 12px',...mono,fontSize:11,outline:'none',
    }}
    onFocus={e=>e.target.style.borderColor='var(--accent)'}
    onBlur={e=>e.target.style.borderColor='var(--border)'}/>
  )
  return (
    <div style={{flex:1,overflowY:'auto',padding:32}}>
      <div style={{marginBottom:36}}>
        <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.1em',marginBottom:6}}>SYSTEM CONFIG — v9.2.0</div>
        <div style={{...serif,fontStyle:'italic',fontSize:32,color:'var(--text)',lineHeight:1,marginBottom:6}}>Preferences &<span style={{display:'block',fontSize:36}}>Control</span></div>
        <div style={{fontSize:12,color:'var(--text-dim)',lineHeight:1.6,maxWidth:480,marginTop:10}}>Configure your Modal deployment endpoint and simulation defaults.</div>
      </div>

      {[
        {num:'PART I',title:'API Configuration',desc:'Connect your Modal v9 deployment. Enter the base URL — endpoints are derived automatically.',fields:(
          <>
            {field('Modal Base URL (e.g. https://xxx.modal.run)',input(draft.apiUrl,v=>setDraft(d=>({...d,apiUrl:v}))))}
            {field('API Token (optional)',input('','()=>{}','password',{placeholder:'Bearer token if auth enabled'}))}
          </>
        )},
        {num:'PART II',title:'Simulation Defaults',desc:'Default parameters for new experiments.',fields:(
          <>
            {field('Default Temperature (K)',input(draft.defaultTemp,v=>setDraft(d=>({...d,defaultTemp:v})),'number',{min:100,max:2000}))}
            {field('Default Accuracy Mode',(
              <div style={{display:'flex',border:'1px solid var(--border)',overflow:'hidden',maxWidth:200}}>
                {['fast','accurate'].map(m=>(
                  <button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:'8px 6px',cursor:'pointer',fontSize:10,fontWeight:500,...sans,border:'none',background:mode===m?'var(--text)':'transparent',color:mode===m?'var(--bg)':'var(--text-dim)',transition:'background 0.15s'}}>
                    {m.charAt(0).toUpperCase()+m.slice(1)}
                  </button>
                ))}
              </div>
            ))}
          </>
        )},
        {num:'PART III',title:'Interface',desc:'Rendering preferences and display options.',fields:(
          <>

            {field('Atom Style',(
              <div style={{position:'relative'}}>
                <select value={draft.atomStyle} onChange={e=>setDraft(d=>({...d,atomStyle:e.target.value}))} style={{width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',color:'var(--text)',padding:'9px 12px',...mono,fontSize:11,outline:'none',appearance:'none',WebkitAppearance:'none'}}>
                  {[{v:'ball-stick',l:'Ball and Stick'},{v:'spacefill',l:'Space Fill'},{v:'wireframe',l:'Wireframe'}].map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <span style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)',fontSize:10,pointerEvents:'none'}}>▾</span>
              </div>
            ))}
          </>
        )},
      ].map(sec=>(
        <div key={sec.num} style={{display:'flex',gap:32,marginBottom:32,paddingBottom:32,borderBottom:'1px solid var(--border2)'}}>
          <div style={{width:180,flexShrink:0}}>
            <div style={{...mono,fontSize:9,color:'var(--text-dim)',letterSpacing:'0.1em',marginBottom:6}}>{sec.num}</div>
            <div style={{...serif,fontStyle:'italic',fontSize:18,color:'var(--text)',marginBottom:6}}>{sec.title}</div>
            <div style={{fontSize:10,color:'var(--text-dim)',lineHeight:1.6}}>{sec.desc}</div>
          </div>
          <div style={{flex:1,display:'flex',flexDirection:'column',gap:14}}>{sec.fields}</div>
        </div>
      ))}

      <div style={{display:'flex',alignItems:'center',gap:16,justifyContent:'flex-end',paddingTop:8}}>
        <div style={{fontSize:10,color:'var(--text-dim)',flex:1,lineHeight:1.5}}>Changes are saved to local storage and applied to new experiments. The base URL is required to run simulations.</div>
        <button onClick={()=>setDraft(settings)} style={{padding:'9px 16px',background:'transparent',color:'var(--text-dim)',border:'1px solid var(--border)',cursor:'pointer',...sans,fontSize:10,fontWeight:500,letterSpacing:'0.06em',textTransform:'uppercase'}}>Discard</button>
        <button onClick={save} style={{padding:'9px 24px',background:'var(--text)',color:'var(--bg)',border:'none',cursor:'pointer',...sans,fontSize:10,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',transition:'opacity 0.15s'}}
          onMouseEnter={e=>e.target.style.opacity='0.85'} onMouseLeave={e=>e.target.style.opacity='1'}
        >Publish Settings →</button>
      </div>
    </div>
  )
}

// ── ROOT APP ──────────────────────────────────────────────

export default function App() {
  const [page, setPage]         = useState('dashboard')
  const [tab, setTab]           = useState('simulation')
  const [mode, setMode]         = useState(()=>localStorage.getItem('molsim_mode')||'fast')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sessionCount, setSessionCount] = useState(1)
  const [sessionId, setSessionId]       = useState('001-ALPHA-00')
  const [simulations, setSimulations]   = useState([])

  // Pipeline
  const [pipeStatus, setPipeStatus] = useState('idle')
  const [pipeSteps, setPipeSteps]   = useState([])
  const [pipeLogs, setPipeLogs]     = useState([{text:'MolSim v9.0 engine ready. Awaiting reaction prompt.',type:'info',time:'00:00'}])
  const [pipeResult, setPipeResult] = useState(null)
  const [callId, setCallId]         = useState(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const logStart   = useRef(null)
  const startTime  = useRef(null)
  const pollTimer  = useRef(null)
  const elapsedTimer = useRef(null)
  const logBodyRef = useRef(null)
  const viewerRef  = useRef(null)
  const pollErrCount = useRef(0)

  // Config
  const [solvent, setSolvent] = useState('water')
  const [temp, setTemp]       = useState(300)
  const [prompt, setPrompt]   = useState('')
  const [settings, setSettings] = useState(()=>({
    apiUrl:     localStorage.getItem('molsim_api_url')||'',
    defaultTemp:localStorage.getItem('molsim_default_temp')||'300',
    fpsCap:     parseInt(localStorage.getItem('molsim_fps_cap')||'60'),
    atomStyle:  localStorage.getItem('molsim_atom_style')||'ball-stick',
  }))

  // Derived from result
  const s4 = pipeResult?.steps?.[3] || {}
  const barrier       = s4.delta_g_barrier_kcal   != null ? s4.delta_g_barrier_kcal.toFixed(2)   : null
  const rxnVal        = s4.delta_g_rxn_kcal        != null ? s4.delta_g_rxn_kcal.toFixed(2)        : null
  const rateStr       = s4.rate_constant_s1        || null
  const rateUnits     = s4.rate_constant_units      || 's⁻¹'
  const ircFrames     = s4.irc_frames               || []
  const energyProfile = s4.energy_profile           || []
  const energyMethod  = s4.energy_method            || (mode==='accurate'?'ωB97X-D3//MACE-OMol-0':'MACE-OMol-0')
  const saddleFound   = s4.saddle_point_found !== false

  const addLog = useCallback((text, type='info') => {
    if (!logStart.current) logStart.current = Date.now()
    const e = Math.floor((Date.now()-logStart.current)/1000)
    const t = `${String(Math.floor(e/60)).padStart(2,'0')}:${String(e%60).padStart(2,'0')}`
    setPipeLogs(prev=>[...prev,{text,type,time:t}])
  },[])

  useEffect(()=>{
    if(logBodyRef.current) logBodyRef.current.scrollTop=logBodyRef.current.scrollHeight
  },[pipeLogs])

  // Elapsed timer
  useEffect(()=>{
    if(pipeStatus==='running'){
      elapsedTimer.current=setInterval(()=>setElapsedSec(Math.floor((Date.now()-startTime.current)/1000)),1000)
    } else {
      clearInterval(elapsedTimer.current)
    }
    return ()=>clearInterval(elapsedTimer.current)
  },[pipeStatus])

  // Polling loop — triggered when callId is set
  useEffect(()=>{
    if(!callId||pipeStatus!=='running') return

    pollTimer.current = setInterval(async()=>{
      try {
        const resp = await fetch(`https://shreyasbestha--molsim-pipeline-api-pipeline-status.modal.run/?call_id=${callId}`)
        const data = await resp.json()

        if(data.status==='running') {
          // Real step info from backend if available, otherwise just show running state
          if(data.current_step != null) {
            const stepIdx = data.current_step - 1
            setPipeSteps(STEP_NAMES.map((n,i)=>({name:n,done:i<stepIdx,active:i===stepIdx,error:false})))
          }
          // If no step info from backend, keep all steps in pending/pulse state — don't fake it
        }

        if(data.status==='complete'){
          clearInterval(pollTimer.current)
          processResult(data.result)
        }

        if(data.status==='error'){
          clearInterval(pollTimer.current)
          setPipeStatus('error')
          setCallId(null)
          const errMsg = data.error||'unknown'
          const isStoich = errMsg.toLowerCase().includes('stoich') || errMsg.toLowerCase().includes('smiles') || errMsg.toLowerCase().includes('atom count')
          addLog(isStoich
            ? `Step 1 failed: LLM returned invalid SMILES. Try a more specific prompt e.g. "SN2 substitution of bromomethane with hydroxide in water"`
            : `Pipeline error: ${errMsg}`, 'error')
        }
      } catch(err) {
        pollErrCount.current = (pollErrCount.current||0) + 1
        if(pollErrCount.current % 3 === 1) addLog(`Poll error: ${err.message} — retrying`, 'warn')
      }
    }, 3000)

    return ()=>clearInterval(pollTimer.current)
  }, [callId, pipeStatus, mode])

  function getBaseUrl(url) {
    try { return new URL(url).origin } catch { return url.replace(/\/api_pipeline.*$/,'') }
  }

  function processResult(result) {
    setPipeResult(result)
    setPipeStatus('complete')
    const steps = result.steps||[]
    steps.forEach((step,i)=>{
      ;(step?.logs||[]).forEach(e=>addLog(e.text,e.type||'info'))
      if(step?.error) addLog(`Step ${i+1} error: ${step.error}`,'error')
    })
    setPipeSteps(STEP_NAMES.map((name,i)=>({name,done:true,active:false,error:!!(steps[i]?.error)})))
    const s4=steps[3]||{},s2=steps[1]||{}
    const irc=s4.irc_frames||[],syms=s2.atom_symbols||[]
    if(irc.length&&syms.length&&irc[0]?.pos) viewerRef.current?.setIRC(irc,syms)
    const b=s4.delta_g_barrier_kcal!=null?s4.delta_g_barrier_kcal.toFixed(2):'—'
    const r=s4.rate_constant_s1||'—', u=s4.rate_constant_units||'s⁻¹'
    addLog(`Pipeline complete — ΔG‡ = ${b} kcal/mol | k = ${r} ${u}`,'success')
    setSimulations(prev=>[{
      id:'MD-2026-'+String(prev.length+7).padStart(3,'0'),status:'ACTIVE',
      title:prompt.length>40?prompt.slice(0,38)+'…':prompt,
      desc:`${solvent[0].toUpperCase()+solvent.slice(1)} | ${temp}K | ΔG‡ = ${b} kcal/mol`,
      tags:[solvent.toUpperCase().slice(0,4),mode==='accurate'?'DFT':'MACE'],
      mode,barrier:b+' kcal/mol',date:'Just now',
      _result:result,_prompt:prompt,_solvent:solvent,_temp:temp,_mode:mode,
    },...prev])
  }

  async function runSimulation() {
    if(!prompt.trim()||pipeStatus==='running') return
    setPipeStatus('running')
    setPipeLogs([])
    logStart.current=null
    setPipeResult(null)
    setPipeSteps(STEP_NAMES.map(n=>({name:n,done:false,active:false,error:false,pending:true})))
    startTime.current=Date.now()
    setElapsedSec(0)
    pollErrCount.current=0
    const sid=String(sessionCount).padStart(3,'0')+'-ALPHA-'+String(Math.floor(Math.random()*99)).padStart(2,'0')
    setSessionId(sid);setSessionCount(c=>c+1)
    viewerRef.current?.showDemo()
    addLog(`Spawning pipeline — mode: ${mode} | solvent: ${solvent} | T: ${temp}K`,'info')
    try {
      const resp=await fetch(`https://shreyasbestha--molsim-pipeline-api-pipeline-start.modal.run/`,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({prompt:prompt.trim(),temperature:temp,n_microstates:128,accuracy_mode:mode,solvent}),
      })
      if(!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const data=await resp.json()
      if(!data.call_id) throw new Error(data.error||'No call_id returned')
      setCallId(data.call_id)
      addLog(`Pipeline spawned — ID: ${data.call_id.slice(0,14)}… | polling every 3s`,'info')
    } catch(err) {
      setPipeStatus('error')
      addLog(`Failed to start pipeline: ${err.message}`,'error')
    }
  }

  function cancelSimulation() {
    clearInterval(pollTimer.current)
    setPipeStatus('idle')
    setCallId(null)
    addLog('Simulation cancelled.','warn')
  }

  function newExperiment() {
    cancelSimulation()
    setPrompt('')
    setPipeLogs([{text:'New experiment. Awaiting reaction prompt.',type:'info',time:'00:00'}])
    logStart.current=null
    setPipeResult(null)
    setPipeSteps([])
    viewerRef.current?.clearAll()
    setPage('dashboard')
    setTab('simulation')
  }

  function openSim(item) {
    setPage('dashboard');setTab('simulation')
    if(!item._result){
      setPipeLogs([
        {text:`Loaded archived: ${item.title}`,type:'info',time:'00:00'},
        {text:'Full pipeline data not available for pre-loaded items.',type:'warn',time:'00:00'},
      ])
      setPipeResult({steps:[null,null,null,{
        delta_g_barrier_kcal:parseFloat(item.barrier)||null,delta_g_rxn_kcal:null,
        rate_constant_s1:null,rate_constant_units:'s⁻¹',irc_frames:[],energy_profile:[],
        energy_method:item.mode==='accurate'?'ωB97X-D3':'MACE-OMol-0',
      },null,null]})
      setPipeStatus('complete');viewerRef.current?.clearAll();return
    }
    const result=item._result
    setPipeResult(result);setPipeStatus('complete')
    const logs=[]
    ;(result.steps||[]).forEach(step=>(step?.logs||[]).forEach(e=>logs.push({text:e.text,type:e.type||'info',time:'00:00'})))
    logs.push({text:`Loaded: ${item.title}`,type:'success',time:'00:00'})
    setPipeLogs(logs)
    setPipeSteps(STEP_NAMES.map((n,i)=>({name:n,done:true,active:false,error:!!(result.steps?.[i]?.error)})))
    const s4=result.steps?.[3]||{},s2=result.steps?.[1]||{}
    const irc=s4.irc_frames||[],syms=s2.atom_symbols||[]
    if(irc.length&&syms.length&&irc[0]?.pos) viewerRef.current?.setIRC(irc,syms)
    else viewerRef.current?.clearAll()
  }

  const globalCss = `
    @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@300;400;500&display=swap');
    :root{
      --bg:#f5f2ee;
      --surface:#faf8f5;
      --surface2:#f0ede8;
      --border:#ddd9d2;
      --border2:#e8e4de;
      --text:#1a1714;
      --text-dim:#9a9189;
      --text-mid:#6b6358;
      --accent:#8b6f47;
      --accent2:#5a7a6e;
      --green:#3a6b4a;
      --green-dim:#e8f0eb;
      --red:#8b3a3a;
    }
    *{margin:0;padding:0;box-sizing:border-box}
    html,body,#root{height:100%;overflow:hidden;background:var(--bg);color:var(--text)}
    body{font-family:'DM Sans',sans-serif;font-size:13px}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:var(--border)}
    input,select,textarea,button{font-family:inherit}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
    @keyframes slideIndeterminate{
      0%{width:0%;margin-left:0%}
      50%{width:60%;margin-left:20%}
      100%{width:0%;margin-left:100%}
    }
    select option{background:#f5f2ee;color:#1a1714}
  `

  return (
    <>
      <style>{globalCss}</style>
      <div style={{display:'flex',height:'100vh',background:'var(--bg)'}}>
        <Sidebar page={page} setPage={setPage} open={sidebarOpen} setOpen={setSidebarOpen} onNewExperiment={newExperiment}/>
        <div style={{flex:1,display:'flex',flexDirection:'column',minWidth:0,overflow:'hidden'}}>
          <Header sessionId={sessionId} page={page} setPage={setPage} setSidebarOpen={setSidebarOpen}/>
          {page==='dashboard'&&(
            <DashboardPage
              tab={tab} setTab={setTab}
              mode={mode} setMode={setMode}
              solvent={solvent} setSolvent={setSolvent}
              temp={temp} setTemp={setTemp}
              prompt={prompt} setPrompt={setPrompt}
              pipeStatus={pipeStatus} pipeSteps={pipeSteps}
              pipeLogs={pipeLogs} logBodyRef={logBodyRef}
              elapsedSec={elapsedSec}
              viewerRef={viewerRef} settings={settings}
              barrier={barrier} rxnVal={rxnVal}
              rateStr={rateStr} rateUnits={rateUnits}
              ircFrames={ircFrames} energyProfile={energyProfile}
              energyMethod={energyMethod} saddleFound={saddleFound}
              pipeResult={pipeResult} s4={s4}
              onRun={runSimulation} onCancel={cancelSimulation}
            />
          )}
          {page==='library'&&<LibraryPage simulations={simulations} onOpen={openSim}/>}
          {page==='settings'&&<SettingsPage settings={settings} setSettings={setSettings} mode={mode} setMode={setMode}/>}
        </div>
      </div>
    </>
  )
}
