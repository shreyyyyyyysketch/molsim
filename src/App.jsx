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

const CAFFEINE_SYMBOLS = ['C','C','C','C','C','C','C','C','N','N','N','N','O','O','H','H','H','H','H','H','H','H','H','H']
const CAFFEINE_POSITIONS = [
  [1.2124,0.518,0.0],[-0.0492,1.1746,0.0],[1.2714,1.8282,0.0],[-1.2144,0.212,0.0],[0.0492,-0.5,0.0],
  [-1.45,2.64,0.0],[2.56,2.48,0.0],[-0.1,-2.0,0.0],
  [0.0,0.0,0.0],[1.2714,0.0,0.0],[-1.2144,1.62,0.0],[0.0492,2.24,0.0],
  [-2.38,-0.4,0.0],[2.38,0.518,0.0],
  [-1.45,3.54,0.0],[-2.42,2.28,0.0],[-1.22,2.64,0.9],
  [2.56,3.38,0.0],[3.5,2.15,0.0],[2.42,2.5,0.9],
  [-0.1,-2.9,0.0],[-1.06,-1.8,0.0],[0.78,-2.2,0.0],
  [0.0492,-0.5,1.08]
]

const STEP_NAMES = ['LLM Gateway','Linear Interp TS','Solvation','MACE + DFT','Surface Hop','Kinetic Summary']
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
    const W=area.clientWidth||300, H=area.clientHeight||300
    if(W===0||H===0) return  // guard: don't init if hidden/zero-size

    t.current.scene=new THREE.Scene()
    t.current.camera=new THREE.PerspectiveCamera(60,W/H,0.1,1000)
    t.current.camera.position.set(0,0,12)
    t.current.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true})
    t.current.renderer.setSize(W,H)
    t.current.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
    t.current.renderer.setClearColor(0xf0ede8, 1)
    t.current.renderer.shadowMap.enabled = true

    // Light-theme lighting: strong ambient for clean visibility
    const amb=new THREE.AmbientLight(0xffffff, 1.2); t.current.scene.add(amb)
    const dir1=new THREE.DirectionalLight(0xffffff, 0.7); dir1.position.set(6,10,8); dir1.castShadow=true; t.current.scene.add(dir1)
    const dir2=new THREE.DirectionalLight(0xffffff, 0.2); dir2.position.set(-6,-4,-6); t.current.scene.add(dir2)
    const fill=new THREE.DirectionalLight(0xf0ede8, 0.15); fill.position.set(0,0,10); t.current.scene.add(fill)

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
      if(t.current.renderer){ t.current.renderer.dispose(); t.current.renderer=null }
    }
  },[])

  useImperativeHandle(ref,()=>({
    showDemo:()=>{ threeClear(t.current) },
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
    <div ref={areaRef} style={{position:'relative',flex:1,background:'#f0ede8',minHeight:0,minWidth:0}}>
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
          <text x={p.l-5} y={ty(v)+3.5} textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize={8} fill="var(--text-dim)">{v}</text>
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
          <text x={tx(i)} y={ty(pt.e)-11} textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize={9}
            fill={pt.ts?'var(--accent)':'var(--text-dim)'}>{pt.label}</text>
          <text x={tx(i)} y={ty(pt.e)+(pt.ts?22:19)} textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize={8} fill="var(--text-dim)">
            {pt.e>=0?'+':''}{pt.e.toFixed(1)}
          </text>
        </g>
      ))}
      <text transform={`translate(11,${p.t+iH/2})rotate(-90)`} textAnchor="middle" fontFamily="'JetBrains Mono',monospace" fontSize={8} fill="var(--text-dim)" letterSpacing="0.06em">kcal/mol</text>
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
      <text x={p.l} y={H-4} fontFamily="'JetBrains Mono',monospace" fontSize={8} fill="var(--text-dim)">← Reactant</text>
      <text x={p.l+iW} y={H-4} textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize={8} fill="var(--text-dim)">Product →</text>
      <text x={p.l-5} y={ty(vals[mid])+3} textAnchor="end" fontFamily="'JetBrains Mono',monospace" fontSize={8} fill="var(--text-dim)">E rel TS</text>
    </svg>
  )
}

// ── 2D REACTION PREVIEW ───────────────────────────────────
// Renders a clean SVG reaction diagram from SMILES returned by /api_pipeline_preview.
// Uses simple bond-graph layout — no external library needed.
// Each molecule is laid out as a node-link graph with a spring-ish layout seeded
// by element electronegativity order.

function SmilesNode({ symbol, x, y, r = 14 }) {
  const color = ATOM_COLORS[symbol] ?? ATOM_COLORS.default
  const hex = '#' + color.toString(16).padStart(6, '0')
  return (
    <g>
      <circle cx={x} cy={y} r={r} fill={hex} opacity={0.92}
        stroke="rgba(255,255,255,0.55)" strokeWidth={1.5}/>
      {symbol !== 'C' && (
        <text x={x} y={y+4} textAnchor="middle"
          fontFamily="'JetBrains Mono',monospace" fontSize={9}
          fontWeight={600} fill="#fff" style={{pointerEvents:'none'}}>
          {symbol}
        </text>
      )}
    </g>
  )
}

function SmilesMolDiagram({ smiles, width = 120, height = 80 }) {
  // Parse SMILES into atoms + bonds using a minimal regex parser
  // Handles simple organic SMILES: single letters, brackets [X], branches ()
  // Returns SVG group at origin — caller positions it
  const atoms = []
  const bonds = []

  const parseSmiles = (s) => {
    const stack = []
    let prev = null
    let i = 0
    while (i < s.length) {
      let sym = null
      // Bracketed atom e.g. [OH-], [Na+], [C@@H]
      if (s[i] === '[') {
        const end = s.indexOf(']', i)
        const inner = s.slice(i+1, end)
        sym = inner.match(/^([A-Z][a-z]?)/)?.[1] || inner[0]?.toUpperCase()
        i = end + 1
      } else if (/[A-Z]/.test(s[i])) {
        // Two-letter element
        sym = /[A-Z][a-z]/.test(s.slice(i,i+2)) ? s.slice(i,i+2) : s[i]
        i += sym.length
      } else if (s[i] === '(') {
        stack.push(prev); i++; continue
      } else if (s[i] === ')') {
        prev = stack.pop(); i++; continue
      } else {
        // bond chars =, #, -, ., etc.
        i++; continue
      }
      if (!sym) continue
      const idx = atoms.length
      atoms.push({ sym, idx })
      if (prev !== null) bonds.push([prev, idx])
      prev = idx
    }
  }

  // Handle multi-fragment SMILES (e.g. "CO.[Br-]")
  smiles.split('.').forEach(frag => { if (frag) parseSmiles(frag) })

  if (!atoms.length) return null

  // Simple circular layout
  const cx = width/2, cy = height/2
  const r = Math.min(width, height) * 0.32
  const positions = atoms.map((_, i) => {
    if (atoms.length === 1) return { x: cx, y: cy }
    const angle = (i / atoms.length) * Math.PI * 2 - Math.PI/2
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) }
  })

  return (
    <g>
      {bonds.map(([a, b], i) => (
        <line key={i}
          x1={positions[a].x} y1={positions[a].y}
          x2={positions[b].x} y2={positions[b].y}
          stroke="var(--border)" strokeWidth={1.5} strokeLinecap="round"/>
      ))}
      {atoms.map((atom, i) => (
        <SmilesNode key={i} symbol={atom.sym}
          x={positions[i].x} y={positions[i].y} r={atoms.length>6?11:14}/>
      ))}
    </g>
  )
}

// Compact version for the sidebar — shows SMILES text + reaction type badge
function Preview2DCompact({ previewData }) {
  const reactants = previewData?.reactant_smiles || []
  const product   = previewData?.product_smiles  || ''
  const rxnType   = previewData?.reaction_type   || ''
  const solvent   = previewData?.solvent         || ''
  if (!reactants.length && !product) return null
  return (
    <div style={{animation:'fadeIn 0.3s ease'}}>
      {rxnType && (
        <div style={{display:'inline-flex',alignItems:'center',gap:5,marginBottom:7,
          fontSize:9,padding:'2px 8px',background:'var(--accent-dim)',
          color:'var(--accent)',border:'1px solid rgba(194,105,42,0.18)',
          borderRadius:4,letterSpacing:'0.04em',fontWeight:700}}>
          {rxnType}
        </div>
      )}
      <div style={{display:'flex',alignItems:'center',gap:4,flexWrap:'wrap'}}>
        {reactants.map((smi,i) => (
          <span key={i} style={{display:'flex',alignItems:'center',gap:4}}>
            <code style={{...mono,fontSize:9,background:'var(--surface3)',padding:'2px 6px',borderRadius:4,color:'var(--text)'}}>{smi}</code>
            {i < reactants.length-1 && <span style={{color:'var(--text-dim)',fontSize:11}}>+</span>}
          </span>
        ))}
        <span style={{color:'var(--accent)',fontSize:12,fontWeight:300}}>→</span>
        <code style={{...mono,fontSize:9,background:'rgba(194,105,42,0.08)',padding:'2px 6px',borderRadius:4,color:'var(--accent)',border:'1px solid rgba(194,105,42,0.15)'}}>{product}</code>
      </div>
      {solvent && <div style={{marginTop:5,fontSize:9,color:'var(--text-dim)'}}>solvent: <span style={{color:'var(--text-mid)'}}>{solvent}</span></div>}
    </div>
  )
}

function ReactionPreview2D({ previewData }) {
  if (!previewData?.preview_ready) return null
  const reactants = previewData.reactant_smiles || []
  const product   = previewData.product_smiles   || ''
  const rxnType   = previewData.reaction_type    || ''
  const solvent   = previewData.solvent          || ''

  const MOL_W = 120, MOL_H = 80
  const ARROW_W = 48
  const PAD = 12
  const totalMols = reactants.length + 1  // reactants + product
  const totalW = totalMols * MOL_W + (reactants.length) * ARROW_W + (reactants.length > 1 ? 32 : 0) + PAD*2
  const svgH = MOL_H + 32

  // x positions
  let xCursor = PAD
  const reactantXs = reactants.map((_,i) => {
    const x = xCursor; xCursor += MOL_W + (i < reactants.length-1 ? 24 : ARROW_W); return x
  })
  const productX = xCursor

  return (
    <div style={{
      background:'var(--surface)',border:'1px solid var(--border)',
      borderRadius:10,padding:'12px 16px',marginBottom:0,
      animation:'fadeIn 0.4s ease',
    }}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:10}}>
        <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--text-dim)'}}>2D Preview</div>
        {rxnType && <div style={{fontSize:9,padding:'2px 8px',background:'var(--accent-dim)',color:'var(--accent)',border:'1px solid rgba(194,105,42,0.18)',borderRadius:4,letterSpacing:'0.04em',fontWeight:600}}>{rxnType}</div>}
        {solvent && <div style={{fontSize:9,padding:'2px 8px',background:'var(--surface2)',color:'var(--text-dim)',border:'1px solid var(--border)',borderRadius:4,letterSpacing:'0.04em'}}>{solvent}</div>}
        <div style={{marginLeft:'auto',fontSize:9,color:'var(--green)',display:'flex',alignItems:'center',gap:4}}>
          <div style={{width:5,height:5,borderRadius:'50%',background:'var(--green)'}}/>instant
        </div>
      </div>

      <div style={{overflowX:'auto'}}>
        <svg width={Math.max(totalW,320)} height={svgH} style={{display:'block',maxWidth:'100%'}}>
          {/* reactant molecules */}
          {reactants.map((smi, i) => (
            <g key={i} transform={`translate(${reactantXs[i]},0)`}>
              <SmilesMolDiagram smiles={smi} width={MOL_W} height={MOL_H}/>
              <text x={MOL_W/2} y={MOL_H+14} textAnchor="middle"
                fontFamily="'JetBrains Mono',monospace" fontSize={8}
                fill="var(--text-dim)">{smi.length>14?smi.slice(0,13)+'…':smi}</text>
              {/* plus sign between reactants */}
              {i < reactants.length-1 && (
                <text x={MOL_W+10} y={MOL_H/2+4} textAnchor="middle"
                  fontFamily="'DM Sans',sans-serif" fontSize={16}
                  fill="var(--text-dim)" fontWeight={300}>+</text>
              )}
            </g>
          ))}

          {/* arrow */}
          {reactants.length > 0 && (
            <g transform={`translate(${reactantXs[reactantXs.length-1]+MOL_W+4},${MOL_H/2})`}>
              <line x1={0} y1={0} x2={ARROW_W-8} y2={0}
                stroke="var(--accent)" strokeWidth={1.5}/>
              <polygon points={`${ARROW_W-8},-5 ${ARROW_W},0 ${ARROW_W-8},5`}
                fill="var(--accent)"/>
            </g>
          )}

          {/* product molecule */}
          <g transform={`translate(${productX},0)`}>
            <SmilesMolDiagram smiles={product} width={MOL_W} height={MOL_H}/>
            <text x={MOL_W/2} y={MOL_H+14} textAnchor="middle"
              fontFamily="'JetBrains Mono',monospace" fontSize={8}
              fill="var(--accent)">{product.length>14?product.slice(0,13)+'…':product}</text>
          </g>
        </svg>
      </div>
    </div>
  )
}

// ── LIBRARY THUMB ─────────────────────────────────────────

function LibThumb({ seed }) {
  const ref = useRef(null)
  useEffect(()=>{
    const c=ref.current; if(!c) return
    const ctx=c.getContext('2d'),W=c.width,H=c.height
    const rng=s=>{s=Math.sin(s*127.1+seed*311.7)*43758.5453;return s-Math.floor(s)}
    // Light-mode thumbnail: warm cream bg with soft molecule illustration
    const grad = ctx.createLinearGradient(0,0,W,H)
    grad.addColorStop(0,'#f4f1ec'); grad.addColorStop(1,'#ede9e2')
    ctx.fillStyle=grad; ctx.fillRect(0,0,W,H)
    const cx=W/2,cy=H/2,n=4+Math.floor(rng(1)*4),atoms=[]
    for(let i=0;i<n;i++){
      const a=(i/n)*Math.PI*2+rng(i)*0.8,r=20+rng(i+10)*28
      atoms.push({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r})
    }
    atoms.push({x:cx,y:cy})
    ctx.strokeStyle='rgba(140,120,95,0.3)'; ctx.lineWidth=1.5
    for(let i=0;i<n;i++){
      ctx.beginPath();ctx.moveTo(atoms[i].x,atoms[i].y);ctx.lineTo(atoms[n].x,atoms[n].y);ctx.stroke()
      if(i<n-1&&rng(i+20)>0.4){ctx.beginPath();ctx.moveTo(atoms[i].x,atoms[i].y);ctx.lineTo(atoms[i+1].x,atoms[i+1].y);ctx.stroke()}
    }
    const cols=['#c2692a','#888','#dd4444','#3a6fa8','#c2692a','#1e7a4a']
    atoms.forEach((pt,i)=>{
      const r2=i===n?7:3.5+rng(i+30)*3.5
      ctx.beginPath();ctx.arc(pt.x,pt.y,r2,0,Math.PI*2)
      ctx.fillStyle=cols[Math.floor(rng(i+40)*cols.length)]
      ctx.globalAlpha=0.85;ctx.fill();ctx.globalAlpha=1
      ctx.strokeStyle='rgba(255,255,255,0.5)';ctx.lineWidth=1;ctx.stroke()
    })
  },[seed])
  return <canvas ref={ref} width={200} height={140} style={{width:'100%',height:'100%',opacity:1}}/>
}

// ── SHARED STYLE HELPERS ──────────────────────────────────

const mono = { fontFamily:"'JetBrains Mono',monospace" }
const serif = { fontFamily:"'DM Serif Display',serif" }
const sans = { fontFamily:"'DM Sans',sans-serif" }

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
      {open && <div onClick={()=>setOpen(false)} style={{position:'fixed',inset:0,background:'rgba(20,18,16,0.4)',zIndex:99,backdropFilter:'blur(4px)'}}/>}
      <aside style={{
        width:224,background:'var(--surface)',borderRight:'1px solid var(--border)',
        display:'flex',flexDirection:'column',flexShrink:0,zIndex:100,
        boxShadow:window.innerWidth<=768?'var(--shadow-md)':'none',
        ...(window.innerWidth<=768?{position:'fixed',top:0,left:0,bottom:0,transform:open?'translateX(0)':'translateX(-100%)',transition:'transform 0.3s cubic-bezier(0.4,0,0.2,1)'}:{})
      }}>
        <div style={{padding:'22px 20px 18px',borderBottom:'1px solid var(--border)'}}>
          <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:2}}>

            <div style={{...serif,fontSize:20,fontWeight:400,letterSpacing:'0.01em',color:'var(--text)'}}>Stygian</div>
          </div>
          <div style={{fontSize:10,color:'var(--text-dim)',marginTop:5,letterSpacing:'0.04em'}}>Molecular Simulation Engine</div>
        </div>
        <div style={{padding:'12px 14px',borderBottom:'1px solid var(--border2)',display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:28,height:28,background:'var(--accent-dim)',border:'1px solid rgba(194,105,42,0.18)',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:'var(--accent)',fontWeight:600,flexShrink:0,letterSpacing:'-0.02em'}}>A</div>
          <div>
            <div style={{fontSize:12,fontWeight:500,color:'var(--text)'}}>Laboratory Alpha</div>
            <div style={{fontSize:10,color:'var(--text-dim)',marginTop:1}}>Curated Collection</div>
          </div>
        </div>
        <nav style={{flex:1,padding:'8px 10px'}}>
          {items.map(it=>(
            <div key={it.id} onClick={()=>{setPage(it.id);setOpen(false)}} style={{
              display:'flex',alignItems:'center',gap:10,padding:'9px 12px',cursor:'pointer',
              fontSize:13,fontWeight:page===it.id?500:400,borderRadius:8,marginBottom:1,
              color:page===it.id?'var(--text)':'var(--text-mid)',
              background:page===it.id?'var(--surface2)':'transparent',
              transition:'color 0.15s,background 0.15s',
              boxShadow:page===it.id?'var(--shadow-xs)':'none',
            }}
            onMouseEnter={e=>{if(page!==it.id)e.currentTarget.style.background='var(--surface2)'}}
            onMouseLeave={e=>{if(page!==it.id)e.currentTarget.style.background='transparent'}}
            >
              <span style={{opacity:page===it.id?1:0.45,color:page===it.id?'var(--accent)':'currentColor',transition:'opacity 0.15s'}}>{icons[it.id]}</span>
              {it.label}
            </div>
          ))}
        </nav>
        <div style={{padding:'12px 10px 18px',borderTop:'1px solid var(--border)'}}>
          <button onClick={onNewExperiment} style={{
            width:'100%',padding:'10px 12px',
            background:'linear-gradient(135deg,var(--accent-bright),var(--accent))',
            color:'#fff',border:'none',cursor:'pointer',
            ...sans,fontSize:12,fontWeight:600,borderRadius:9,
            letterSpacing:'0.01em',transition:'opacity 0.15s,box-shadow 0.15s',
            boxShadow:'0 2px 10px rgba(194,105,42,0.25)',
          }}
          onMouseEnter={e=>{e.currentTarget.style.opacity='0.9';e.currentTarget.style.boxShadow='0 4px 16px rgba(194,105,42,0.35)'}}
          onMouseLeave={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.boxShadow='0 2px 10px rgba(194,105,42,0.25)'}}
          >+ New Experiment</button>
        </div>
      </aside>
    </>
  )
}

// ── HEADER ────────────────────────────────────────────────

function Header({ sessionId, page, setPage, setSidebarOpen }) {
  const titles={dashboard:'Reaction Simulation',library:'Project Library',settings:'Preferences'}
  return (
    <header style={{
      height:56,borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',
      padding:'0 24px',gap:16,flexShrink:0,background:'var(--surface)',
      boxShadow:'0 1px 0 var(--border)',
    }}>
      <button onClick={()=>setSidebarOpen(o=>!o)} style={{
        display:'none',flexDirection:'column',gap:4,cursor:'pointer',padding:6,
        background:'none',border:'none',borderRadius:6,
        ...(window.innerWidth<=768?{display:'flex'}:{})
      }}>
        {[0,1,2].map(i=><span key={i} style={{display:'block',width:16,height:1.5,background:'var(--text-mid)',borderRadius:1}}/>)}
      </button>
      <div style={{display:'flex',flexDirection:'column',gap:1,flex:1,minWidth:0}}>
        <div style={{fontSize:10,color:'var(--text-dim)',letterSpacing:'0.05em'}}>Session <span style={{...mono,fontSize:9,color:'var(--accent)'}}>{sessionId}</span></div>
        <div style={{...serif,fontSize:18,fontWeight:400,color:'var(--text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',lineHeight:1.2}}>{titles[page]||''}</div>
      </div>
      <div style={{display:'flex',alignItems:'center',gap:6,marginLeft:'auto'}}>
        {[
          {icon:<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" style={{width:13,height:13}}><circle cx="6" cy="6" r="4"/><line x1="9" y1="9" x2="13" y2="13"/></svg>, fn:undefined},
          {icon:<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" style={{width:13,height:13}}><circle cx="7" cy="7" r="2"/><path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.9 2.9l1.1 1.1M10 10l1.1 1.1M2.9 11.1L4 10M10 4l1.1-1.1"/></svg>, fn:()=>setPage('settings')},
          {icon:<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" style={{width:13,height:13}}><circle cx="7" cy="7" r="6"/><line x1="7" y1="6" x2="7" y2="10"/><circle cx="7" cy="4.5" r="0.5" fill="currentColor" stroke="none"/></svg>, fn:undefined},
        ].map((btn,i)=>(
          <div key={i} onClick={btn.fn} style={{
            width:32,height:32,border:'1px solid var(--border)',borderRadius:7,display:'flex',alignItems:'center',
            justifyContent:'center',cursor:'pointer',color:'var(--text-dim)',
            background:'var(--surface2)',transition:'border-color 0.15s,color 0.15s,background 0.15s',
          }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.color='var(--accent)';e.currentTarget.style.background='var(--accent-dim)'}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text-dim)';e.currentTarget.style.background='var(--surface2)'}}
          >{btn.icon}</div>
        ))}
        <div style={{width:32,height:32,background:'var(--accent-dim)',border:'1px solid rgba(194,105,42,0.22)',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,color:'var(--accent)',fontWeight:600,cursor:'pointer',letterSpacing:'-0.02em'}}>U</div>
      </div>
    </header>
  )
}

// ── DASHBOARD ─────────────────────────────────────────────

function DashboardPage(props) {
  const { tab, setTab, ...rest } = props
  return (
    <div style={{display:'flex',flexDirection:'column',flex:1,overflow:'hidden'}}>
      <div style={{display:'flex',borderBottom:'1px solid var(--border)',background:'var(--surface)',flexShrink:0,padding:'0 12px'}}>
        {['simulation','analytics'].map(t=>(
          <div key={t} onClick={()=>setTab(t)} style={{
            padding:'0 18px',height:42,cursor:'pointer',fontSize:12,fontWeight:tab===t?600:400,
            display:'flex',alignItems:'center',letterSpacing:tab===t?'-0.01em':'0',
            color:tab===t?'var(--text)':'var(--text-dim)',
            borderBottom:tab===t?'2px solid var(--accent)':'2px solid transparent',
            transition:'color 0.15s,border-color 0.15s',
          }}>{t.charAt(0).toUpperCase()+t.slice(1)}</div>
        ))}
      </div>
      <div style={{flex:1,overflow:'hidden',display:'flex'}}>
        <div style={{display:tab==='simulation'?'flex':'none',flex:1,overflow:'hidden'}}>
          <SimulationTab {...rest} previewData={rest.previewData}/>
        </div>
        <div style={{display:tab==='analytics'?'flex':'none',flex:1,overflow:'hidden'}}>
          <AnalyticsTab energyProfile={rest.energyProfile} ircFrames={rest.ircFrames} s4={rest.s4} pipeResult={rest.pipeResult} previewData={rest.previewData}/>
        </div>
      </div>
    </div>
  )
}

// ── SIMULATION TAB ────────────────────────────────────────

function SimulationTab({ mode, setMode, solvent, setSolvent, temp, setTemp,
  prompt, setPrompt, pipeStatus, pipeSteps, pipeLogs, logBodyRef, elapsedSec,
  viewerRef, barrier, rxnVal, rateStr, rateUnits, ircFrames, energyMethod,
  saddleFound, pipeResult, s4, onRun, onCancel, settings, previewData }) {

  const [showMetrics, setShowMetrics] = useState(false)
  const running = pipeStatus === 'running'
  const isMobile = window.innerWidth <= 768

  const s6 = pipeResult?.steps?.[5] || {}
  const MetricsPanel = () => (
    <div style={{background:'var(--surface)',display:'flex',flexDirection:'column',
      ...(isMobile
        ? {borderTop:'1px solid var(--border)',overflowY:'auto',maxHeight:'50vh'}
        : {width:216,borderLeft:'1px solid var(--border)',overflowY:'auto',flexShrink:0})
    }}>
      <div style={{padding:'14px 16px 11px',borderBottom:'1px solid var(--border2)',background:'var(--surface2)',display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:4,height:4,borderRadius:'50%',background:'var(--accent)',flexShrink:0}}/>
        <div style={{...serif,fontSize:14,fontWeight:400,color:'var(--text)'}}>Metrics</div>
      </div>
      <div style={{padding:'14px 16px',borderBottom:'1px solid var(--border2)'}}>
        {[
          {key:'ΔG‡',       val:barrier!=null?`${barrier} kcal/mol`:null},
          {key:'ΔG rxn',    val:rxnVal!=null?`${rxnVal} kcal/mol`:null},
          {key:'Rate k',    val:rateStr?`${rateStr} ${rateUnits}`:null},
          {key:'Rate Method',val:s4?.rrkm_available?`RRKM κ=${s4?.wigner_kappa?.toFixed(2)||'?'}`:pipeStatus==='complete'?'Eyring TST':null},
          {key:'Half-life',  val:s6?.half_life_str||null},
          {key:'Yield est.', val:s6?.thermodynamic_yield_pct!=null?`${s6.thermodynamic_yield_pct.toFixed(1)}%`:null},
          {key:'Branching',  val:s6?.branching_ratio||null},
          {key:'Solvent',   val:solvent||null},
          {key:'IRC Frames',val:ircFrames?.length?`${ircFrames.length} frames`:null},
        ].map(({key,val})=>(
          <div key={key} style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',padding:'7px 0',borderBottom:'1px solid var(--border2)'}}>
            <div style={{fontSize:10,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.05em',textTransform:'uppercase'}}>{key}</div>
            <div style={{...mono,fontSize:key==='ΔG‡'||key==='ΔG rxn'?13:11,color:val?'var(--accent)':'var(--text-dim)',textAlign:'right',maxWidth:130,wordBreak:'break-all'}}>
              {val||'—'}
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:'14px 16px',borderBottom:'1px solid var(--border2)'}}>
        <div style={{fontSize:10,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.05em',textTransform:'uppercase',marginBottom:8}}>Method</div>
        <div style={{...mono,fontSize:9,padding:'4px 8px',letterSpacing:'0.04em',borderRadius:5,
          ...(pipeStatus==='idle'?{background:'var(--surface2)',color:'var(--text-dim)',border:'1px solid var(--border)'}
            :mode==='accurate'?{background:'rgba(91,155,213,0.1)',color:'var(--accent2)',border:'1px solid rgba(91,155,213,0.25)'}
            :{background:'var(--green-dim)',color:'var(--green)',border:'1px solid rgba(61,158,110,0.3)'}),
        }}>
          {pipeStatus==='idle'?'Awaiting run':pipeStatus==='running'?'Computing…':energyMethod}
        </div>
        {s4?.solvation_method&&pipeStatus==='complete'&&(
          <div style={{...mono,fontSize:9,color:'var(--text-dim)',marginTop:6,lineHeight:1.4}}>{s4.solvation_method}</div>
        )}
        {pipeStatus==='running'&&<div style={{fontSize:10,color:'var(--text-dim)',marginTop:8}}>Polling every 3s…</div>}
        {s4?.is_bimolecular&&s4?.t_ds_correction_kcal&&(
          <div style={{...mono,fontSize:9,color:'var(--accent2)',marginTop:6}}>-TΔS‡ +{s4.t_ds_correction_kcal} kcal/mol applied</div>
        )}
        {s4?.is_true_ts===true&&(
          <div style={{fontSize:10,color:'var(--green)',marginTop:6}}>✓ True TS confirmed ({s4.ts_imaginary_cm1?.toFixed(0)} cm⁻¹)</div>
        )}
        {s4?.is_true_ts===false&&(
          <div style={{fontSize:10,color:'#c8a055',marginTop:6}}>⚠ TS not confirmed by Hessian</div>
        )}
        {pipeResult&&!saddleFound&&(
          <div style={{fontSize:10,color:'var(--red)',marginTop:6}}>No saddle point found</div>
        )}
      </div>
      {pipeResult&&(s6?.summary||s4?.extra?.narrative)&&(
        <div style={{margin:'14px 16px',padding:12,background:'var(--surface2)',border:'1px solid var(--border2)',borderLeft:'2px solid var(--accent)',borderRadius:'0 6px 6px 0'}}>
          <div style={{fontSize:9,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:6}}>Summary</div>
          <div style={{fontSize:11,color:'var(--text-mid)',lineHeight:1.6}}>{s6?.summary||s4?.extra?.narrative}</div>
        </div>
      )}
      {s6?.competing_pathway&&(
        <div style={{margin:'0 16px 14px',padding:10,background:'var(--accent-dim)',border:'1px solid rgba(194,105,42,0.18)',borderRadius:6}}>
          <div style={{fontSize:9,fontWeight:600,color:'var(--accent)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>Competing Pathway</div>
          <div style={{fontSize:11,color:'var(--text-mid)',lineHeight:1.5}}>{s6.competing_pathway} ({s6.branching_ratio})</div>
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
              <div style={{fontSize:9,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:6}}>Mode</div>
              <div style={{display:'flex',border:'1px solid var(--border)',overflow:'hidden',borderRadius:7,background:'var(--surface2)'}}>
                {['fast','accurate'].map(m=>(
                  <button key={m} onClick={()=>setMode(m)} style={{
                    padding:'5px 10px',cursor:'pointer',fontSize:11,fontWeight:500,...sans,border:'none',
                    background:mode===m?'var(--accent)':'transparent',
                    color:mode===m?'#fff':'var(--text-dim)',transition:'background 0.15s,color 0.15s',
                  }}>{m.charAt(0).toUpperCase()+m.slice(1)}</button>
                ))}
              </div>
            </div>
            {/* Temp */}
            <div style={{padding:'10px 14px',borderRight:'1px solid var(--border)'}}>
              <div style={{fontSize:9,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:6}}>Temp</div>
              <div style={{display:'flex',alignItems:'center',border:'1px solid var(--border)',background:'var(--surface2)',overflow:'hidden',width:100,borderRadius:7}}>
                <input type="number" value={temp} onChange={e=>setTemp(parseFloat(e.target.value)||300)}
                  min={100} max={1000} step={10} style={{
                    flex:1,background:'transparent',border:'none',padding:'5px 8px',
                    color:'var(--text)',...mono,fontSize:11,outline:'none',width:60,
                  }}/>
                <div style={{padding:'0 7px',fontSize:10,color:'var(--text-dim)',borderLeft:'1px solid var(--border)'}}>K</div>
              </div>
            </div>
            {/* Solvent */}
            <div style={{padding:'10px 14px',borderRight:'1px solid var(--border)'}}>
              <div style={{fontSize:9,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:6}}>Solvent</div>
              <div style={{position:'relative'}}>
                <select value={solvent} onChange={e=>setSolvent(e.target.value)} style={{
                  background:'var(--surface2)',border:'1px solid var(--border)',
                  color:'var(--text)',padding:'5px 24px 5px 8px',fontSize:11,outline:'none',
                  cursor:'pointer',appearance:'none',WebkitAppearance:'none',borderRadius:7,
                }}>
                  {SOLVENTS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <span style={{position:'absolute',right:7,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)',fontSize:10,pointerEvents:'none'}}>▾</span>
              </div>
            </div>
            {/* Pipeline progress (compact) */}
            {pipeSteps.length>0&&(
              <div style={{padding:'10px 14px',minWidth:140}}>
                <div style={{fontSize:9,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:6}}>
                  Pipeline {running?`· ${Math.floor(elapsedSec/60).toString().padStart(2,'0')}:${(elapsedSec%60).toString().padStart(2,'0')}` : ''}
                </div>
                {pipeSteps.map((step,i)=>(
                  <div key={i} style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                    <div style={{flex:1,height:2,background:'var(--border)',overflow:'hidden',borderRadius:1}}>
                      <div style={{height:'100%',background:step.error?'var(--red)':'var(--accent)',width:step.done?'100%':'0%',transition:step.done?'width 0.5s ease-out':'none',animation:step.active?'slideIndeterminate 1.8s ease-in-out infinite':'none'}}/>
                    </div>
                    <div style={{...mono,fontSize:9,color:step.done?(step.error?'var(--red)':'var(--green)'):'var(--text-dim)',width:10,textAlign:'center'}}>
                      {step.done?(step.error?'✗':'✓'):(step.active?'…':'·')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── 2D PREVIEW (shows while 3D is computing) ── */}
        {previewData?.preview_ready && (
          <div style={{flexShrink:0,padding:'10px 12px',borderBottom:'1px solid var(--border)',background:'var(--surface)'}}>
            <Preview2DCompact previewData={previewData}/>
          </div>
        )}

        {/* ── VIEWER ── */}
        <div style={{position:'relative',background:'#f0ede8',flex:1,minHeight:0,maxHeight:'calc(100dvh - 260px)'}}>
          {isMobile ? <MolViewer ref={viewerRef} running={running} fpsCap={60} atomStyle="ball-stick"/> : null}
          {!viewerRef.current?.hasMol?.() && pipeStatus==='idle' && (
            <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:8,pointerEvents:'none'}}>
              <div style={{fontSize:32,opacity:0.06}}>⬡</div>
              <div style={{fontWeight:400,fontSize:13,color:'var(--text-dim)',opacity:0.5}}>No simulation active</div>
            </div>
          )}
          {pipeStatus==='idle'&&viewerRef.current?.hasMol?.()&&(
            <div style={{position:'absolute',bottom:46,left:0,right:0,display:'flex',justifyContent:'center',pointerEvents:'none'}}>
              <div style={{background:'rgba(255,255,255,0.92)',border:'1px solid var(--border)',padding:'5px 14px',display:'flex',flexDirection:'column',alignItems:'center',gap:1,backdropFilter:'blur(8px)',borderRadius:8}}>
                <div style={{fontWeight:500,fontSize:12,color:'var(--text)',letterSpacing:'0.01em'}}>Caffeine</div>
                <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.08em'}}>C₈H₁₀N₄O₂ · DEMO MOLECULE</div>
              </div>
            </div>
          )}
          <div style={{position:'absolute',top:10,left:10,display:'flex',gap:6,alignItems:'center'}}>
            <div style={{display:'flex',alignItems:'center',gap:5,background:'rgba(255,255,255,0.92)',border:'1px solid var(--border)',padding:'4px 10px',...mono,fontSize:9,color:'var(--text-mid)',backdropFilter:'blur(8px)',borderRadius:20}}>
              <div style={{width:4,height:4,borderRadius:'50%',background:running?'var(--green)':'var(--text-dim)',animation:running?'pulse 1.2s ease-in-out infinite':'none'}}/>
              {running?'LIVE':pipeStatus==='complete'?'COMPLETE':'IDLE'}
            </div>
          </div>
          {pipeStatus==='idle'&&viewerRef.current?.hasMol?.()&&(
            <div style={{position:'absolute',bottom:14,left:'50%',transform:'translateX(-50%)',pointerEvents:'none'}}>
              <div style={{background:'rgba(255,255,255,0.92)',border:'1px solid var(--border)',padding:'5px 16px',display:'flex',flexDirection:'column',alignItems:'center',gap:1,backdropFilter:'blur(8px)',borderRadius:8}}>
                <div style={{fontWeight:500,fontSize:13,color:'var(--text)',letterSpacing:'0.01em'}}>Caffeine</div>
                <div style={{...mono,fontSize:8,color:'var(--text-dim)',letterSpacing:'0.08em'}}>C₈H₁₀N₄O₂ · DEMO MOLECULE</div>
              </div>
            </div>
          )}
          <div style={{position:'absolute',bottom:10,right:10,display:'flex',gap:6}}>
            {[{icon:'↺',fn:()=>viewerRef.current?.resetView()},{icon:'⤢',fn:()=>viewerRef.current?.fullscreen()}].map(b=>(
              <div key={b.icon} onClick={b.fn} style={{width:30,height:30,background:'rgba(255,255,255,0.92)',border:'1px solid var(--border)',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'var(--text-dim)',fontSize:12,backdropFilter:'blur(8px)'}}>{b.icon}</div>
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
                  <div style={{fontSize:8,color:step.done?'var(--green)':step.active?'var(--accent)':'var(--text-dim)',textAlign:'center',whiteSpace:'nowrap',overflow:'hidden',maxWidth:'100%',textOverflow:'ellipsis'}}>
                    {step.active?'▶ '+step.name.split(' ')[0]:step.done?(step.error?'✗':'✓'):step.name.split(' ')[0]}
                  </div>
                </div>
              ))}
              <div style={{...mono,fontSize:9,color:'var(--text-dim)',flexShrink:0,paddingLeft:6,borderLeft:'1px solid var(--border2)'}}>
                {Math.floor(elapsedSec/60).toString().padStart(2,'0')}:{(elapsedSec%60).toString().padStart(2,'0')}
              </div>
            </div>
          )}
          <div ref={logBodyRef} style={{flex:1,overflowY:'auto',padding:'5px 12px',display:'flex',flexDirection:'column',gap:1}}>
            {pipeLogs.length===0 && (
              <div style={{fontSize:10,color:'var(--text-dim)',opacity:0.4,padding:'4px 0'}}>Ready — enter a reaction prompt below</div>
            )}
            {pipeLogs.map((log,i)=>(
              <div key={i} style={{display:'flex',gap:6,alignItems:'flex-start',...mono,fontSize:9,lineHeight:1.4}}>
                <span style={{color:'var(--text-dim)',flexShrink:0,opacity:0.6}}>{log.time}</span>
                <span style={{color:{info:'var(--text-mid)',success:'var(--green)',warn:'#c8a055',data:'var(--accent)',error:'var(--red)'}[log.type]||'var(--text-mid)'}}>{log.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── PROMPT BAR ── */}
        <div style={{borderTop:'2px solid var(--accent)',padding:'10px 12px',display:'flex',gap:8,alignItems:'flex-end',background:'var(--surface)',flexShrink:0,minHeight:56}}>
          <div style={{flex:1,border:'1px solid var(--border)',background:'var(--surface2)',display:'flex',alignItems:'center',gap:6,padding:'0 12px',borderRadius:10}}>
            <span style={{color:'var(--text-dim)',fontSize:13,flexShrink:0}}>⬡</span>
            <textarea value={prompt} onChange={e=>setPrompt(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();onRun()}}}
              onChange={e=>{setPrompt(e.target.value);e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,72)+'px'}}
              placeholder="Describe a reaction…"
              rows={1} style={{
                flex:1,background:'transparent',border:'none',padding:'8px 0',
                color:'var(--text)',fontSize:13,outline:'none',resize:'none',
                minHeight:34,maxHeight:72,overflow:'hidden',
              }}/>
          </div>
          <div style={{display:'flex',gap:6,flexShrink:0}}>
            <button onClick={()=>setShowMetrics(m=>!m)} style={{
              padding:'8px 10px',background:showMetrics?'var(--accent-dim)':'transparent',
              color:showMetrics?'var(--accent)':'var(--text-dim)',border:'1px solid var(--border)',cursor:'pointer',fontSize:14,height:38,borderRadius:8,
            }}>◈</button>
            {running
              ? <button onClick={onCancel} style={{padding:'8px 14px',background:'var(--red-dim)',color:'var(--red)',border:'1px solid rgba(192,80,96,0.3)',cursor:'pointer',fontSize:12,fontWeight:600,height:38,whiteSpace:'nowrap',borderRadius:8}}>Stop</button>
              : <button onClick={onRun} disabled={!prompt.trim()} style={{padding:'8px 16px',background:prompt.trim()?'linear-gradient(135deg,var(--accent-bright),var(--accent))':'var(--surface3)',color:prompt.trim()?'#fff':'var(--text-dim)',border:'none',cursor:prompt.trim()?'pointer':'not-allowed',fontSize:12,fontWeight:600,height:38,whiteSpace:'nowrap',borderRadius:8,boxShadow:prompt.trim()?'0 2px 12px rgba(194,105,42,0.25)':'none'}}>Run →</button>
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
      <div style={{width:216,borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',overflowY:'auto',flexShrink:0,background:'var(--surface)'}}>
        <ConfigSection label="Accuracy Mode">
          <div style={{display:'flex',border:'1px solid var(--border)',overflow:'hidden',borderRadius:8,background:'var(--surface2)'}}>
            {['fast','accurate'].map(m=>(
              <button key={m} onClick={()=>setMode(m)} style={{
                flex:1,padding:'8px 6px',cursor:'pointer',fontSize:12,fontWeight:500,
                ...sans,border:'none',borderRadius:m==='fast'?'7px 0 0 7px':'0 7px 7px 0',
                background:mode===m?'var(--accent)':'transparent',
                color:mode===m?'#fff':'var(--text-mid)',transition:'background 0.15s,color 0.15s',
              }}>{m.charAt(0).toUpperCase()+m.slice(1)}</button>
            ))}
          </div>
          <div style={{fontSize:10,color:'var(--text-dim)',marginTop:7}}>
            {mode==='fast'?'~2–4 min · MACE energies':'~8–12 min · DFT + Hessian + RRKM'}
          </div>
        </ConfigSection>

        <ConfigSection label="Temperature">
          <div style={{display:'flex',alignItems:'center',border:'1px solid var(--border)',background:'var(--surface2)',overflow:'hidden',borderRadius:8}}>
            <input type="number" value={temp} onChange={e=>setTemp(parseFloat(e.target.value)||300)}
              min={100} max={1000} step={10} style={{
                flex:1,background:'transparent',border:'none',padding:'9px 12px',
                color:'var(--text)',...mono,fontSize:13,outline:'none',
              }}/>
            <div style={{padding:'0 12px',fontSize:11,color:'var(--text-dim)',borderLeft:'1px solid var(--border)',height:'100%',display:'flex',alignItems:'center'}}>K</div>
          </div>
        </ConfigSection>

        <ConfigSection label="Solvent">
          <div style={{position:'relative'}}>
            <select value={solvent} onChange={e=>setSolvent(e.target.value)} style={{
              width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',
              color:'var(--text)',padding:'9px 12px',fontSize:12,outline:'none',
              cursor:'pointer',appearance:'none',WebkitAppearance:'none',borderRadius:8,
            }}>
              {SOLVENTS.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <span style={{position:'absolute',right:11,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)',fontSize:11,pointerEvents:'none'}}>▾</span>
          </div>
        </ConfigSection>

        {previewData?.preview_ready && (
          <div style={{padding:'12px 16px',borderBottom:'1px solid var(--border2)'}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--text-dim)',marginBottom:8}}>2D Preview</div>
            <Preview2DCompact previewData={previewData}/>
          </div>
        )}

        {pipeSteps.length>0 && (
          <ConfigSection label="Pipeline Progress">
            {pipeSteps.map((step,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,padding:'3px 0'}}>
                <div style={{fontSize:10,color:'var(--text-dim)',width:16,flexShrink:0,fontWeight:500}}>{i+1}</div>
                <div style={{flex:1,height:3,background:'var(--border)',overflow:'hidden',borderRadius:2}}>
                  <div style={{height:'100%',borderRadius:2,background:step.error?'var(--red)':'var(--accent)',width:step.done?'100%':'0%',transition:step.done?'width 0.5s ease-out':'none',animation:step.active?'slideIndeterminate 1.8s ease-in-out infinite':'none'}}/>
                </div>
                <div style={{fontSize:10,color:step.done?(step.error?'var(--red)':'var(--green)'):'var(--text-dim)',width:14,textAlign:'center',flexShrink:0}}>
                  {step.done?(step.error?'✗':'✓'):(step.active?'…':'·')}
                </div>
              </div>
            ))}
            {running && (
              <div style={{...mono,fontSize:10,color:'var(--text-dim)',marginTop:8}}>
                {Math.floor(elapsedSec/60).toString().padStart(2,'0')}:{(elapsedSec%60).toString().padStart(2,'0')} elapsed
              </div>
            )}
          </ConfigSection>
        )}
      </div>

      {/* CENTER */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>
        <div style={{flex:1,position:'relative',background:'#ede9e2',minHeight:0}}>
          {isMobile ? null : <MolViewer ref={viewerRef} running={running} fpsCap={60} atomStyle="ball-stick"/>}
          {!viewerRef.current?.hasMol?.() && pipeStatus==='idle' && (
            <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,pointerEvents:'none'}}>
              <div style={{width:56,height:56,borderRadius:'50%',background:'rgba(194,105,42,0.06)',border:'1px solid rgba(194,105,42,0.12)',display:'flex',alignItems:'center',justifyContent:'center'}}>
                <div style={{fontSize:24,color:'var(--accent)',opacity:0.35}}>⬡</div>
              </div>
              <div style={{...serif,fontWeight:400,fontSize:16,color:'var(--text-dim)',opacity:0.6}}>No simulation active</div>
              <div style={{fontSize:10,color:'var(--text-dim)',letterSpacing:'0.04em',opacity:0.4}}>Enter a reaction prompt below to begin</div>
            </div>
          )}
          <div style={{position:'absolute',top:16,left:16,display:'flex',gap:8,alignItems:'center'}}>
            <div style={{display:'flex',alignItems:'center',gap:6,background:'rgba(255,255,255,0.92)',border:'1px solid var(--border)',padding:'5px 11px',borderRadius:20,...mono,fontSize:9,letterSpacing:'0.06em',color:'var(--text-mid)',backdropFilter:'blur(8px)'}}>
              <div style={{width:5,height:5,borderRadius:'50%',background:running?'var(--green)':'var(--text-dim)',animation:running?'pulse 1.2s ease-in-out infinite':'none'}}/>
              {running?'LIVE':pipeStatus==='complete'?'COMPLETE':'IDLE'}
            </div>
          </div>
          <div style={{position:'absolute',bottom:16,right:16,display:'flex',gap:8}}>
            {[{icon:'↺',fn:()=>viewerRef.current?.resetView()},{icon:'⤢',fn:()=>viewerRef.current?.fullscreen()}].map(b=>(
              <div key={b.icon} onClick={b.fn} style={{
                width:32,height:32,background:'rgba(255,255,255,0.92)',border:'1px solid var(--border)',
                borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',
                color:'var(--text-dim)',fontSize:13,backdropFilter:'blur(8px)',transition:'color 0.15s,border-color 0.15s,box-shadow 0.15s',
                boxShadow:'0 1px 4px rgba(0,0,0,0.06)',
              }}
              onMouseEnter={e=>{e.currentTarget.style.color='var(--accent)';e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.boxShadow='0 2px 8px rgba(194,105,42,0.18)'}}
              onMouseLeave={e=>{e.currentTarget.style.color='var(--text-dim)';e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.boxShadow='0 1px 4px rgba(0,0,0,0.06)'}}
              >{b.icon}</div>
            ))}
          </div>
        </div>

        <div style={{height:running?180:120,borderTop:'1px solid var(--border)',background:'var(--surface)',display:'flex',flexDirection:'column',flexShrink:0,transition:'height 0.3s ease'}}>
          <div style={{display:'flex',alignItems:'center',padding:'6px 16px',borderBottom:'1px solid var(--border2)',gap:8,flexShrink:0,background:'var(--surface2)'}}>
            <div style={{fontSize:9,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--text-dim)',flex:1}}>Console</div>
            {running && <div style={{...mono,fontSize:9,color:'var(--green)',letterSpacing:'0.06em',animation:'pulse 1.5s ease-in-out infinite',display:'flex',alignItems:'center',gap:4}}><span style={{width:5,height:5,borderRadius:'50%',background:'var(--green)',display:'inline-block'}}/>LIVE</div>}
          </div>
          {running && pipeSteps.length>0 && (
            <div style={{display:'flex',gap:4,padding:'8px 16px',borderBottom:'1px solid var(--border2)',flexShrink:0}}>
              {pipeSteps.map((step,i)=>(
                <div key={i} style={{flex:1,display:'flex',flexDirection:'column',gap:3}}>
                  <div style={{width:'100%',height:3,background:'var(--border)',overflow:'hidden',borderRadius:2}}>
                    <div style={{
                      height:'100%',borderRadius:2,
                      background:step.error?'var(--red)':'var(--accent)',
                      width:step.done?'100%':step.active?'65%':'0%',
                      opacity:step.active?0.75:1,
                      transition:'width 0.8s ease-out',
                      animation:step.active?'pulse 1.5s ease-in-out infinite':'none',
                    }}/>
                  </div>
                  <div style={{fontSize:9,color:step.done?'var(--green)':step.active?'var(--accent)':'var(--text-dim)',textAlign:'center',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {step.active?'▶ '+step.name:step.done?(step.error?'✗ '+step.name:'✓ '+step.name):step.name}
                  </div>
                </div>
              ))}
              <div style={{...mono,fontSize:10,color:'var(--text-dim)',flexShrink:0,paddingLeft:10,borderLeft:'1px solid var(--border2)',display:'flex',alignItems:'center'}}>
                {Math.floor(elapsedSec/60).toString().padStart(2,'0')}:{(elapsedSec%60).toString().padStart(2,'0')}
              </div>
            </div>
          )}
          <div ref={logBodyRef} style={{flex:1,overflowY:'auto',padding:'8px 16px',display:'flex',flexDirection:'column',gap:2}}>
            {pipeLogs.length===0 && (
              <div style={{fontSize:11,color:'var(--text-dim)',opacity:0.4,marginTop:2}}>Ready — enter a reaction prompt below to begin</div>
            )}
            {pipeLogs.map((log,i)=>(
              <div key={i} style={{display:'flex',gap:10,alignItems:'flex-start',...mono,fontSize:10,lineHeight:1.5,animation:'fadeIn 0.2s ease'}}>
                <span style={{color:'var(--text-dim)',flexShrink:0,opacity:0.6}}>{log.time}</span>
                <span style={{color:{info:'var(--text-mid)',success:'var(--green)',warn:'#c8a055',data:'var(--accent)',error:'var(--red)'}[log.type]||'var(--text-mid)'}}>{log.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{borderTop:'1px solid var(--border)',padding:'12px 16px',display:'flex',gap:10,alignItems:'flex-end',background:'var(--surface)',flexShrink:0}}>
          <div style={{flex:1,border:'1.5px solid var(--border)',background:'var(--bg)',display:'flex',alignItems:'center',gap:8,padding:'0 14px',borderRadius:11,transition:'border-color 0.2s,box-shadow 0.2s'}}
            onFocusCapture={e=>{ e.currentTarget.style.borderColor='var(--accent)'; e.currentTarget.style.boxShadow='0 0 0 3px var(--accent-dim)' }}
            onBlurCapture={e=>{ e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.boxShadow='none' }}
          >
            <span style={{color:'var(--accent)',fontSize:14,flexShrink:0,opacity:0.7}}>⬡</span>
            <textarea value={prompt} onChange={e=>setPrompt(e.target.value)}
              onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();onRun()}}}
              placeholder="Describe a reaction — e.g. SN2 substitution of bromomethane with hydroxide in water"
              rows={1} style={{
                flex:1,background:'transparent',border:'none',padding:'11px 0',
                color:'var(--text)',fontSize:13,outline:'none',resize:'none',
                minHeight:38,maxHeight:80,lineHeight:1.5,
              }}/>
          </div>
          {running
            ? <button onClick={onCancel} style={{padding:'10px 18px',background:'var(--red-dim)',color:'var(--red)',border:'1px solid rgba(184,48,48,0.22)',cursor:'pointer',fontSize:12,fontWeight:600,letterSpacing:'0.03em',height:42,whiteSpace:'nowrap',borderRadius:9,transition:'background 0.15s'}}>✕ Cancel</button>
            : <button onClick={onRun} disabled={!prompt.trim()} style={{padding:'10px 22px',background:prompt.trim()?'linear-gradient(135deg,var(--accent-bright),var(--accent))':'var(--surface3)',color:prompt.trim()?'#fff':'var(--text-dim)',border:'none',cursor:prompt.trim()?'pointer':'not-allowed',fontSize:12,fontWeight:600,height:42,whiteSpace:'nowrap',borderRadius:9,transition:'all 0.15s',boxShadow:prompt.trim()?'0 2px 10px rgba(194,105,42,0.28)':'none',letterSpacing:'-0.01em'}}>Run →</button>
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
    <div style={{padding:'16px 16px',borderBottom:'1px solid var(--border2)'}}>
      <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--text-dim)',marginBottom:10}}>{label}</div>
      {children}
    </div>
  )
}

// ── ANALYTICS TAB ─────────────────────────────────────────

function AnalyticsTab({ energyProfile, ircFrames, s4, pipeResult, previewData }) {
  const hasData = energyProfile?.length > 0
  if (!hasData) return (
    <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:16}}>
      {previewData?.preview_ready ? (
        <div style={{width:'100%',maxWidth:600,padding:'32px'}}>
          <div style={{...serif,fontSize:18,fontWeight:400,color:'var(--text)',marginBottom:16}}>Reaction Identified</div>
          <ReactionPreview2D previewData={previewData}/>
          <div style={{fontSize:11,color:'var(--text-dim)',marginTop:12,textAlign:'center',opacity:0.6}}>3D simulation running — energy profile will appear when complete</div>
        </div>
      ) : (
        <>
          <div style={{fontSize:36,opacity:0.08}}>⬡</div>
          <div style={{...serif,fontSize:24,fontWeight:400,color:'var(--text)',opacity:0.3}}>Analytics</div>
          <div style={{fontSize:11,color:'var(--text-dim)',letterSpacing:'0.04em',opacity:0.4}}>Run a simulation first to see energy profiles</div>
        </>
      )}
    </div>
  )
  return (
    <div style={{flex:1,overflowY:'auto',padding:'32px'}}>
      {previewData?.preview_ready && (
        <div style={{marginBottom:24}}>
          <ReactionPreview2D previewData={previewData}/>
        </div>
      )}
      <div style={{fontSize:10,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:4}}>Reaction Energy Profile</div>
      <div style={{...serif,fontWeight:400,fontSize:22,color:'var(--text)',marginBottom:24}}>{s4?.energy_method||'MACE-OMol-0'}</div>

      <div style={{background:'var(--surface)',border:'1px solid var(--border)',padding:'24px',marginBottom:24,borderRadius:10}}>
        <EnergyProfileChart energyProfile={energyProfile}/>
        <div style={{display:'flex',gap:24,marginTop:16}}>
          {[
            {k:'ΔG‡ (gas)',v:s4?.delta_g_barrier_gas_kcal!=null?`${s4.delta_g_barrier_gas_kcal.toFixed(2)} kcal/mol`:'—'},
            {k:'ΔG‡ (solvated)',v:s4?.delta_g_barrier_kcal!=null?`${s4.delta_g_barrier_kcal.toFixed(2)} kcal/mol`:'—'},
            {k:'ΔG rxn',v:s4?.delta_g_rxn_kcal!=null?`${s4.delta_g_rxn_kcal.toFixed(2)} kcal/mol`:'—'},
          ].map(({k,v})=>(
            <div key={k}>
              <div style={{fontSize:9,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:4}}>{k}</div>
              <div style={{...mono,fontSize:15,color:'var(--accent)',fontWeight:500}}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {ircFrames?.length>0&&(
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',padding:'24px',marginBottom:24,borderRadius:10}}>
          <div style={{fontSize:10,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:16}}>
            IRC Energy Trace — {ircFrames.length} frames (TS = t=0)
          </div>
          <IrcEnergyChart ircFrames={ircFrames}/>
        </div>
      )}

      {s4&&(
        <div style={{background:'var(--surface)',border:'1px solid var(--border)',padding:'24px',borderRadius:10}}>
          <div style={{fontSize:10,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:16}}>Kinetic Summary</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:16}}>
            {[
              {k:'Rate Constant',   v:s4.rate_constant_s1?`${s4.rate_constant_s1} ${s4.rate_constant_units||'s⁻¹'}`:'—'},
              {k:'Rate Method',     v:s4.rrkm_available?`RRKM (κ=${s4.wigner_kappa?.toFixed(3)||'—'})`:'Eyring TST'},
              {k:'Reaction Order',  v:s4.is_bimolecular?'Bimolecular (k₂)':'Unimolecular (k₁)'},
              {k:'Entropic Penalty',v:s4.t_ds_correction_kcal?`+${s4.t_ds_correction_kcal} kcal/mol`:'n/a'},
              {k:'Energy Method',   v:s4.energy_method||'—'},
              {k:'Solvation',       v:s4.solvation_method||'TPSA-Born'},
              {k:'Saddle Point',    v:s4.saddle_point_found!==false?'✓ Found':'✗ Not found'},
              {k:'TS Validation',   v:s4.is_true_ts===true?`✓ True TS (${s4.ts_imaginary_cm1?.toFixed(0)||'?'} cm⁻¹)`:s4.is_true_ts===false?'⚠ Not confirmed':'—'},
              {k:'ZPE at TS',       v:s4.zpe_ts_kcal!=null?`${s4.zpe_ts_kcal.toFixed(2)} kcal/mol`:'—'},
              {k:'IRC Method',      v:s4.irc_method?s4.irc_method.replace('Gonzalez-Schlegel steepest descent','G-S mass-weighted'):'mass-weighted'},
              {k:'IRC Frames',      v:s4.irc_frames?.length?`${s4.irc_frames.length} frames`:'—'},
              {k:'Temperature',     v:s4.temperature?`${s4.temperature} K`:'—'},
            ].map(({k,v})=>(
              <div key={k} style={{borderLeft:'2px solid var(--border)',paddingLeft:14}}>
                <div style={{fontSize:9,fontWeight:600,color:'var(--text-dim)',letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:5}}>{k}</div>
                <div style={{...mono,fontSize:12,color:'var(--text)',fontWeight:500,lineHeight:1.4}}>{v}</div>
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
      <div style={{padding:'28px 32px 20px',borderBottom:'1px solid var(--border)',flexShrink:0,display:'flex',alignItems:'flex-end',justifyContent:'space-between',background:'var(--surface)'}}>
        <div>
          <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--text-dim)',marginBottom:6}}>Simulation Archive</div>
          <div style={{...serif,fontSize:28,fontWeight:400,color:'var(--text)',lineHeight:1}}>Project Library</div>
          <div style={{fontSize:12,color:'var(--text-dim)',marginTop:8,maxWidth:420,lineHeight:1.6}}>A curated collection of molecular trajectories and structural computations.</div>
        </div>
      </div>
      <div style={{flex:1,overflowY:'auto',padding:'24px 32px',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:16,alignContent:'start'}}>
        {all.length===0&&(
          <div style={{gridColumn:'1/-1',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:'80px 0',gap:12,opacity:0.5}}>
            <div style={{fontSize:36,opacity:0.4}}>⬡</div>
            <div style={{...serif,fontWeight:400,fontSize:20,color:'var(--text-dim)'}}>No simulations yet</div>
            <div style={{fontSize:11,color:'var(--text-dim)',textAlign:'center',maxWidth:300,lineHeight:1.6}}>Run a reaction from the dashboard and your results will appear here.</div>
          </div>
        )}
        {all.map((item,i)=>(
          <div key={item.id} onClick={()=>onOpen(item)} style={{border:'1px solid var(--border)',background:'var(--surface)',cursor:'pointer',transition:'border-color 0.2s,transform 0.15s,box-shadow 0.2s',overflow:'hidden',borderRadius:12,boxShadow:'var(--shadow-xs)'}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor='var(--accent)';e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 6px 24px rgba(20,18,16,0.1),0 0 0 1px rgba(194,105,42,0.15)'}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='var(--shadow-xs)'}}
          >
            <div style={{height:130,background:'var(--surface2)',position:'relative',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',borderBottom:'1px solid var(--border)'}}>
              <LibThumb seed={i}/>
            </div>
            <div style={{padding:'14px 14px 12px'}}>
              <div style={{fontSize:9,color:'var(--text-dim)',display:'flex',justifyContent:'space-between',marginBottom:6}}>
                <span style={{...mono}}>{item.id}</span><span style={{color:item.status==='ACTIVE'?'var(--green)':'var(--text-dim)'}}>{item.status}</span>
              </div>
              <div style={{fontSize:13,fontWeight:500,color:'var(--text)',marginBottom:5,lineHeight:1.4}}>{item.title}</div>
              <div style={{fontSize:11,color:'var(--text-dim)',lineHeight:1.5,marginBottom:10}}>{item.desc}</div>
              <div style={{display:'flex',gap:5,flexWrap:'wrap',alignItems:'center'}}>
                {item.tags.map(t=><span key={t} style={{fontSize:9,padding:'2px 7px',border:'1px solid var(--border)',color:'var(--text-dim)',letterSpacing:'0.04em',textTransform:'uppercase',borderRadius:4}}>{t}</span>)}
                <span style={{fontSize:9,padding:'2px 7px',border:'1px solid',letterSpacing:'0.04em',textTransform:'uppercase',borderRadius:4,...(item.mode==='accurate'?{borderColor:'rgba(91,155,213,0.3)',color:'var(--accent2)'}:{borderColor:'rgba(61,158,110,0.3)',color:'var(--green)'})}}>{item.mode}</span>
                <span style={{fontSize:9,color:'var(--text-dim)',marginLeft:'auto'}}>{item.date}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{padding:'12px 32px',borderTop:'1px solid var(--border)',background:'var(--surface)',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0}}>
        <div style={{...mono,fontSize:9,color:'var(--text-dim)'}}>
          {all.length} simulation{all.length!==1?'s':''} archived
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
    localStorage.setItem('stygian_api_url', draft.apiUrl)
    localStorage.setItem('stygian_default_temp', draft.defaultTemp)
    localStorage.setItem('stygian_fps_cap', String(draft.fpsCap))
    localStorage.setItem('stygian_atom_style', draft.atomStyle)
    localStorage.setItem('stygian_mode', mode)
  }
  const field = (label, el) => (
    <div>
      <div style={{fontSize:11,fontWeight:500,color:'var(--text-mid)',marginBottom:6}}>{label}</div>
      {el}
    </div>
  )
  const input = (val, onChange, type='text', extra={}) => (
    <input type={type} value={val} onChange={e=>onChange(e.target.value)} {...extra} style={{
      width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',color:'var(--text)',
      padding:'10px 14px',fontSize:13,outline:'none',borderRadius:8,transition:'border-color 0.15s',
    }}
    onFocus={e=>e.target.style.borderColor='var(--accent)'}
    onBlur={e=>e.target.style.borderColor='var(--border)'}/>
  )
  return (
    <div style={{flex:1,overflowY:'auto',padding:40,background:'var(--bg)'}}>
      <div style={{marginBottom:40,maxWidth:720}}>
        <div style={{fontSize:10,fontWeight:600,letterSpacing:'0.08em',textTransform:'uppercase',color:'var(--text-dim)',marginBottom:8}}>System Config · v11.0.0</div>
        <div style={{...serif,fontWeight:400,fontSize:34,color:'var(--text)',lineHeight:1.1,marginBottom:10}}>Preferences &<br/>Control</div>
        <div style={{fontSize:13,color:'var(--text-dim)',lineHeight:1.6,maxWidth:480}}>Configure your Modal deployment endpoint and simulation defaults.</div>
      </div>

      {[
        {num:'I',title:'API Configuration',desc:'Connect your Modal v11 deployment. Enter the base URL — endpoints are derived automatically.',fields:(
          <>
            {field('Modal Base URL (e.g. https://xxx.modal.run)',input(draft.apiUrl,v=>setDraft(d=>({...d,apiUrl:v}))))}
            {field('API Token (optional)',input('','()=>{}','password',{placeholder:'Bearer token if auth enabled'}))}
          </>
        )},
        {num:'II',title:'Simulation Defaults',desc:'Default parameters for new experiments.',fields:(
          <>
            {field('Default Temperature (K)',input(draft.defaultTemp,v=>setDraft(d=>({...d,defaultTemp:v})),'number',{min:100,max:2000}))}
            {field('Default Accuracy Mode',(
              <div style={{display:'flex',border:'1px solid var(--border)',overflow:'hidden',maxWidth:200,borderRadius:8,background:'var(--surface2)'}}>
                {['fast','accurate'].map(m=>(
                  <button key={m} onClick={()=>setMode(m)} style={{flex:1,padding:'9px 8px',cursor:'pointer',fontSize:12,fontWeight:500,...sans,border:'none',background:mode===m?'var(--accent)':'transparent',color:mode===m?'#fff':'var(--text-dim)',transition:'background 0.15s'}}>
                    {m.charAt(0).toUpperCase()+m.slice(1)}
                  </button>
                ))}
              </div>
            ))}
          </>
        )},
        {num:'III',title:'Interface',desc:'Rendering preferences and display options.',fields:(
          <>
            {field('Atom Style',(
              <div style={{position:'relative'}}>
                <select value={draft.atomStyle} onChange={e=>setDraft(d=>({...d,atomStyle:e.target.value}))} style={{width:'100%',background:'var(--surface2)',border:'1px solid var(--border)',color:'var(--text)',padding:'10px 14px',fontSize:13,outline:'none',appearance:'none',WebkitAppearance:'none',borderRadius:8,transition:'border-color 0.15s'}}
                  onFocus={e=>e.target.style.borderColor='var(--accent)'}
                  onBlur={e=>e.target.style.borderColor='var(--border)'}
                >
                  {[{v:'ball-stick',l:'Ball and Stick'},{v:'spacefill',l:'Space Fill'},{v:'wireframe',l:'Wireframe'}].map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
                <span style={{position:'absolute',right:12,top:'50%',transform:'translateY(-50%)',color:'var(--text-dim)',fontSize:11,pointerEvents:'none'}}>▾</span>
              </div>
            ))}
          </>
        )},
      ].map(sec=>(
        <div key={sec.num} style={{display:'flex',gap:40,marginBottom:36,paddingBottom:36,borderBottom:'1px solid var(--border)',maxWidth:720}}>
          <div style={{width:180,flexShrink:0}}>
            <div style={{...mono,fontSize:9,color:'var(--text-dim)',marginBottom:6,opacity:0.6}}>PART {sec.num}</div>
            <div style={{fontSize:16,fontWeight:600,color:'var(--text)',marginBottom:6}}>{sec.title}</div>
            <div style={{fontSize:11,color:'var(--text-dim)',lineHeight:1.6}}>{sec.desc}</div>
          </div>
          <div style={{flex:1,display:'flex',flexDirection:'column',gap:16}}>{sec.fields}</div>
        </div>
      ))}

      <div style={{display:'flex',alignItems:'center',gap:12,justifyContent:'flex-end',paddingTop:4,maxWidth:720}}>
        <div style={{fontSize:11,color:'var(--text-dim)',flex:1,lineHeight:1.5}}>Changes are saved to local storage and applied to new experiments.</div>
        <button onClick={()=>setDraft(settings)} style={{padding:'10px 18px',background:'transparent',color:'var(--text-mid)',border:'1px solid var(--border)',cursor:'pointer',fontSize:12,fontWeight:500,borderRadius:8,transition:'border-color 0.15s'}}
          onMouseEnter={e=>e.target.style.borderColor='var(--text-dim)'} onMouseLeave={e=>e.target.style.borderColor='var(--border)'}
        >Discard</button>
        <button onClick={save} style={{padding:'10px 24px',background:'linear-gradient(135deg,var(--accent-bright),var(--accent))',color:'#fff',border:'none',cursor:'pointer',fontSize:12,fontWeight:600,borderRadius:8,boxShadow:'0 2px 12px rgba(194,105,42,0.2)',transition:'opacity 0.15s'}}
          onMouseEnter={e=>e.target.style.opacity='0.85'} onMouseLeave={e=>e.target.style.opacity='1'}
        >Save Settings →</button>
      </div>
    </div>
  )
}

// ── LANDING PAGE ──────────────────────────────────────────

function LandingPage({ onEnter }) {
  const canvasRef = useRef(null)
  const [entered, setEntered] = useState(false)
  const isMob = window.innerWidth <= 640

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const W = el.clientWidth, H = el.clientHeight
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(52, W / H, 0.1, 200)
    camera.position.set(0, 0, isMob ? 13 : 15)
    const renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true })
    renderer.setSize(W, H)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x000000, 0) // transparent — CSS handles bg

    scene.add(new THREE.AmbientLight(0xfff5e8, 1.4))
    const d1 = new THREE.DirectionalLight(0xffd4a0, 1.6); d1.position.set(8,12,10); scene.add(d1)
    const d2 = new THREE.DirectionalLight(0xa0c4ff, 0.3); d2.position.set(-8,-4,-8); scene.add(d2)

    const nucleus = new THREE.Mesh(
      new THREE.SphereGeometry(isMob ? 1.0 : 1.3, 64, 48),
      new THREE.MeshStandardMaterial({ color:0xc2692a, roughness:0.10, metalness:0.70, emissive:0xc2692a, emissiveIntensity:0.25 })
    )
    scene.add(nucleus)
    const glow = new THREE.PointLight(0xe07830, 5, 16); scene.add(glow)

    const sc = isMob ? 0.78 : 1
    const rings = []
    ;[[0,0,0],[Math.PI/3,0,0],[Math.PI/1.6,Math.PI/4,0]].forEach((rot,i) => {
      const r = new THREE.Mesh(
        new THREE.TorusGeometry((4+i*1.8)*sc, 0.055, 12, 120),
        new THREE.MeshStandardMaterial({ color:i===0?0xc2692a:0xb8b0a4, roughness:0.3, metalness:0.45, opacity:0.75, transparent:true })
      )
      r.rotation.set(...rot); rings.push(r); scene.add(r)
    })

    const COLORS = [0xc2692a, 0x3a6fa8, 0x1e7a4a, 0x8b3060, 0xb8963a]
    const orbiters = []
    rings.forEach((ring,ri) => {
      for (let i=0; i<(2+ri); i++) {
        const angle = (i/(2+ri))*Math.PI*2
        const radius = (4+ri*1.8)*sc
        const s = new THREE.Mesh(
          new THREE.SphereGeometry((0.18+ri*0.05)*sc, 20, 16),
          new THREE.MeshStandardMaterial({ color:COLORS[(ri*2+i)%COLORS.length], roughness:0.18, metalness:0.6 })
        )
        orbiters.push({ mesh:s, ri, angle, radius, speed:0.006+ri*0.002+i*0.001 })
        scene.add(s)
      }
    })

    let t=0, mx=0, my=0, af
    const onMouse = e=>{ mx=(e.clientX/window.innerWidth-0.5)*2; my=(e.clientY/window.innerHeight-0.5)*2 }
    const onTouch = e=>{ if(e.touches[0]){ mx=(e.touches[0].clientX/window.innerWidth-0.5)*2; my=(e.touches[0].clientY/window.innerHeight-0.5)*2 } }
    const onResize = ()=>{ const W2=el.clientWidth,H2=el.clientHeight; camera.aspect=W2/H2; camera.updateProjectionMatrix(); renderer.setSize(W2,H2) }
    window.addEventListener('mousemove',onMouse)
    window.addEventListener('touchmove',onTouch,{passive:true})
    window.addEventListener('resize',onResize)

    const animate = ()=>{
      af=requestAnimationFrame(animate); t+=0.009
      nucleus.rotation.y+=0.005; nucleus.rotation.x+=0.002
      rings[0].rotation.z+=0.007; rings[1].rotation.z-=0.005; rings[2].rotation.z+=0.004; rings[2].rotation.y+=0.002
      orbiters.forEach(o=>{
        o.angle+=o.speed
        const lx=Math.cos(o.angle)*o.radius, ly=Math.sin(o.angle)*o.radius
        const e2=rings[o.ri].rotation
        const cv=Math.cos(e2.x),sv=Math.sin(e2.x),cz=Math.cos(e2.z),sz=Math.sin(e2.z)
        o.mesh.position.set(lx*cz-ly*sv*sz, lx*sz+ly*sv*cz, ly*cv)
      })
      glow.intensity=3.8+Math.sin(t*1.8)*1.2
      camera.position.x+=(mx*1.5-camera.position.x)*0.03
      camera.position.y+=(-my*1.0-camera.position.y)*0.03
      camera.lookAt(0,0,0)
      renderer.render(scene,camera)
    }
    animate()
    return ()=>{ cancelAnimationFrame(af); window.removeEventListener('mousemove',onMouse); window.removeEventListener('touchmove',onTouch); window.removeEventListener('resize',onResize); renderer.dispose() }
  }, [])

  const handleEnter = ()=>{ setEntered(true); setTimeout(onEnter,520) }

  return (
    <div style={{
      position:'fixed', inset:0, overflow:'hidden',
      fontFamily:"'DM Sans',sans-serif",
      opacity:entered?0:1, transition:'opacity 0.52s ease',
      // warm radial glow background
      background:'radial-gradient(ellipse 80% 70% at 50% 50%, #f5e6cc 0%, #ede0cc 35%, #d4c4a8 70%, #bfad90 100%)',
    }}>

      {/* ── GRAIN TEXTURE OVERLAY ── */}
      <div style={{
        position:'absolute', inset:0, zIndex:1, pointerEvents:'none',
        opacity:0.038,
        backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        backgroundSize:'180px 180px',
      }}/>

      {/* ── THREE.JS CANVAS — full bleed background ── */}
      <canvas ref={canvasRef} style={{
        position:'absolute', inset:0, width:'100%', height:'100%',
        zIndex:2,
      }}/>

      {/* ── VIGNETTE — darkens edges so card text pops ── */}
      <div style={{
        position:'absolute', inset:0, zIndex:3, pointerEvents:'none',
        background:'radial-gradient(ellipse 90% 90% at 50% 50%, transparent 40%, rgba(60,40,20,0.28) 100%)',
      }}/>

      {/* ── NAV ── */}
      <div style={{
        position:'absolute', top:0, left:0, right:0, zIndex:20,
        padding:'16px 24px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        background:'rgba(245,235,210,0.55)', backdropFilter:'blur(16px)',
        borderBottom:'1px solid rgba(194,105,42,0.12)',
        animation:'landingFadeUp 0.6s ease both',
      }}>
        <div style={{display:'flex',alignItems:'center',gap:9}}>
          <span style={{fontFamily:"'DM Serif Display',serif",fontSize:19,color:'#1a1208',letterSpacing:'-0.01em'}}>Stygian</span>
        </div>
        <button onClick={handleEnter} style={{
          padding:'8px 18px', fontSize:12, fontWeight:600,
          background:'rgba(20,12,0,0.82)', color:'#fff', border:'none',
          borderRadius:8, cursor:'pointer', letterSpacing:'-0.01em',
          backdropFilter:'blur(8px)',
          transition:'background 0.15s',
        }}
        onMouseEnter={e=>e.currentTarget.style.background='rgba(20,12,0,1)'}
        onMouseLeave={e=>e.currentTarget.style.background='rgba(20,12,0,0.82)'}
        >Open App →</button>
      </div>

      {/* ── FROSTED GLASS CARD — centred over the molecule ── */}
      <div style={{
        position:'absolute', zIndex:10,
        ...(isMob
          ? { bottom:'72px', left:'20px', right:'20px' }
          : { top:'50%', left:'50%', transform:'translate(-50%, -50%)', width:'min(520px, 55vw)' }
        ),
        background:'rgba(250,243,230,0.55)',
        backdropFilter:'blur(22px) saturate(1.4)',
        WebkitBackdropFilter:'blur(22px) saturate(1.4)',
        border:'1px solid rgba(255,240,210,0.7)',
        borderRadius: isMob ? 20 : 24,
        boxShadow:'0 8px 48px rgba(60,30,0,0.18), 0 1px 0 rgba(255,255,255,0.6) inset',
        padding: isMob ? '28px 20px 24px' : '44px 48px 40px',
        animation:'landingFadeUp 0.8s 0.1s ease both', opacity:0,
      }}>

        {/* Eyebrow */}
        <div style={{
          display:'inline-flex', alignItems:'center', gap:7,
          padding:'4px 12px', marginBottom:22,
          background:'rgba(194,105,42,0.12)',
          border:'1px solid rgba(194,105,42,0.25)',
          borderRadius:20, alignSelf:'flex-start',
          fontSize:10, fontWeight:700, color:'#c2692a',
          letterSpacing:'0.07em', textTransform:'uppercase',
        }}>
          <span style={{width:5,height:5,borderRadius:'50%',background:'#c2692a',display:'inline-block',flexShrink:0,animation:'pulse 2s ease-in-out infinite'}}/>
          Molecular Simulation · v11.0
        </div>

        {/* Headline */}
        <h1 style={{
          fontFamily:"'DM Serif Display',serif",
          fontSize: isMob ? 36 : 'clamp(44px,4.8vw,68px)',
          fontWeight:400, lineHeight:1.02,
          color:'#1a1208', letterSpacing:'-0.03em',
          margin:'0 0 14px',
        }}>
          Chemistry,<br/>
          <span style={{
            background:'linear-gradient(135deg,#e07830 10%,#b85e20 90%)',
            WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text',
          }}>Computed.</span>
        </h1>

        {/* Subhead */}
        <p style={{
          fontSize: isMob ? 13 : 15,
          color:'#6b5c48', lineHeight:1.7,
          margin:'0 0 28px', maxWidth:380,
        }}>
          From reaction prompt to barrier heights, IRC paths and rate constants — via MACE&nbsp;+&nbsp;DFT, in minutes.
        </p>

        {/* CTA buttons */}
        <div style={{
          display:'flex', gap:10,
          flexDirection: isMob?'column':'row',
          marginBottom:28,
        }}>
          <button onClick={handleEnter} style={{
            padding:'13px 28px', fontSize:14, fontWeight:600,
            background:'linear-gradient(135deg,#e07830,#b85e20)',
            color:'#fff', border:'none', borderRadius:10, cursor:'pointer',
            boxShadow:'0 4px 20px rgba(194,105,42,0.38)',
            transition:'transform 0.15s,box-shadow 0.15s',
            letterSpacing:'-0.01em', flex: isMob?1:'none',
          }}
          onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 30px rgba(194,105,42,0.48)'}}
          onMouseLeave={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='0 4px 20px rgba(194,105,42,0.38)'}}
          >Launch Simulation →</button>
          <button style={{
            padding:'13px 22px', fontSize:14, fontWeight:500,
            background:'rgba(255,255,255,0.5)', color:'#1a1208',
            border:'1px solid rgba(194,105,42,0.2)', borderRadius:10, cursor:'pointer',
            backdropFilter:'blur(8px)', transition:'background 0.15s',
            letterSpacing:'-0.01em', flex: isMob?1:'none',
          }}
          onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.75)'}
          onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.5)'}
          >View Demo</button>
        </div>

        {/* Stats bar */}
        <div style={{
          display:'flex', gap:0,
          border:'1px solid rgba(194,105,42,0.15)',
          borderRadius:10, overflow:'hidden',
          background:'rgba(255,255,255,0.35)',
          backdropFilter:'blur(8px)',
        }}>
          {[
            {val:'< 3 min',label:'Fast mode'},
            {val:'MACE',label:'+ DFT'},
            {val:'12',label:'Solvents'},
            {val:'ΔG‡',label:'+ IRC'},
          ].map((s,i)=>(
            <div key={i} style={{
              flex:1, padding:'10px 0', textAlign:'center',
              borderRight:i<3?'1px solid rgba(194,105,42,0.1)':'none',
            }}>
              <div style={{fontFamily:"'DM Serif Display',serif",fontSize:15,color:'#1a1208',letterSpacing:'-0.02em',whiteSpace:'nowrap'}}>{s.val}</div>
              <div style={{fontSize:9,fontWeight:700,color:'#9a8060',letterSpacing:'0.06em',textTransform:'uppercase',marginTop:1,whiteSpace:'nowrap'}}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <div style={{
        position:'absolute', bottom:0, left:0, right:0, zIndex:20,
        padding:'10px 24px',
        display:'flex', alignItems:'center', justifyContent:'space-between',
        background:'rgba(245,235,210,0.45)', backdropFilter:'blur(12px)',
        borderTop:'1px solid rgba(194,105,42,0.1)',
        animation:'landingFadeUp 0.7s 0.55s ease both', opacity:0,
      }}>
        <div style={{fontSize:10,color:'#a08060'}}>© 2026 Stygian</div>
        <div style={{display:'flex',gap:16}}>
          {['Privacy','Terms','Status'].map(l=>(
            <span key={l} style={{fontSize:10,color:'#a08060',cursor:'pointer'}}>{l}</span>
          ))}
        </div>
      </div>

    </div>
  )
}

// ── ROOT APP ──────────────────────────────────────────────

export default function App() {
  const [page, setPage]         = useState('landing')
  const [tab, setTab]           = useState('simulation')
  const [mode, setMode]         = useState(()=>localStorage.getItem('stygian_mode')||'fast')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sessionCount, setSessionCount] = useState(1)
  const [sessionId, setSessionId]       = useState('001-ALPHA-00')
  const [simulations, setSimulations]   = useState([])

  // Pipeline
  const [pipeStatus, setPipeStatus] = useState('idle')
  const [pipeSteps, setPipeSteps]   = useState([])
  const [pipeLogs, setPipeLogs]     = useState([{text:'Stygian v11.0 engine ready. Awaiting reaction prompt.',type:'info',time:'00:00'}])
  const [pipeResult, setPipeResult] = useState(null)
  const [callId, setCallId]         = useState(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [previewData, setPreviewData] = useState(null)   // Step 1 instant 2D preview
  const logStart   = useRef(null)
  const startTime  = useRef(null)
  const pollTimer  = useRef(null)
  const elapsedTimer = useRef(null)
  const logBodyRef = useRef(null)
  const viewerRef  = useRef(null)
  const pollErrCount = useRef(0)
  const modalUrls    = useRef(null)   // set in runSimulation, read by polling effect

  // Config
  const [solvent, setSolvent] = useState('water')
  const [temp, setTemp]       = useState(300)
  const [prompt, setPrompt]   = useState('')
  const [settings, setSettings] = useState(()=>({
    apiUrl:     localStorage.getItem('stygian_api_url')||'',
    defaultTemp:localStorage.getItem('stygian_default_temp')||'300',
    fpsCap:     parseInt(localStorage.getItem('stygian_fps_cap')||'60'),
    atomStyle:  localStorage.getItem('stygian_atom_style')||'ball-stick',
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

  // Show C60 demo on initial mount
  useEffect(()=>{
    const t = setTimeout(()=>{ viewerRef.current?.showDemo() }, 100)
    return ()=>clearTimeout(t)
  },[])

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
        const statusUrl = modalUrls.current?.status
          || 'https://shreyyasshreyyas--stygian-pipeline-api-pipeline-status.modal.run/'
        const resp = await fetch(`${statusUrl}?call_id=${callId}`)
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
    clearInterval(pollTimer.current)
    setCallId(null)
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
    setPreviewData(null)
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

    // Resolve Modal base URL: use custom apiUrl from settings if set, else default deployment
    const DEFAULT_BASE = 'https://shreyyasshreyyas--molsim-pipeline'
    const rawBase = (settings.apiUrl||'').trim().replace(/\/+$/,'')
    // If user pasted a full endpoint URL, strip down to base; otherwise use as-is or fall back
    const modalBase = rawBase
      ? rawBase.replace(/\/(api_pipeline.*)?$/, '')
      : DEFAULT_BASE

    const URLS = {
      preview: `${modalBase}-api-pipeline-preview.modal.run/`,
      start:   `${modalBase}-api-pipeline-start.modal.run/`,
      status:  `${modalBase}-api-pipeline-status.modal.run/`,
    }
    modalUrls.current = URLS

    // Fire instant 2D preview in parallel (Step 1 only, ~2s)
    fetch(URLS.preview,{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({prompt:prompt.trim()}),
    }).then(r=>r.json()).then(d=>{
      if(d.preview_ready) {
        setPreviewData(d)
        addLog(`2D preview ready — ${d.reaction_type||'reaction'} | reactants: ${(d.reactant_smiles||[]).join(', ')}`,'success')
      }
    }).catch(()=>{})  // preview failure is silent — 3D still runs

    try {
      const resp=await fetch(URLS.start,{
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
    setPreviewData(null)
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
    @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&family=JetBrains+Mono:wght@400;500&display=swap');
    :root{
      --bg:#f5f3ef;
      --surface:#ffffff;
      --surface2:#f4f2ee;
      --surface3:#ede9e2;
      --border:#e4e0d8;
      --border2:#ebe7e0;
      --text:#141210;
      --text-dim:#a89f97;
      --text-mid:#6b6560;
      --accent:#c2692a;
      --accent-dim:rgba(194,105,42,0.09);
      --accent-bright:#e07830;
      --accent2:#3a6fa8;
      --green:#1e7a4a;
      --green-dim:rgba(30,122,74,0.09);
      --red:#b83030;
      --red-dim:rgba(184,48,48,0.09);
      --shadow-xs:0 1px 3px rgba(20,18,16,0.06),0 1px 2px rgba(20,18,16,0.04);
      --shadow-sm:0 2px 8px rgba(20,18,16,0.07),0 1px 3px rgba(20,18,16,0.05);
      --shadow-md:0 4px 16px rgba(20,18,16,0.09),0 2px 6px rgba(20,18,16,0.05);
    }
    *{margin:0;padding:0;box-sizing:border-box}
    html,body,#root{height:100%;overflow:hidden;background:var(--bg);color:var(--text)}
    body{font-family:'DM Sans',sans-serif;font-size:13px;letter-spacing:-0.01em;-webkit-font-smoothing:antialiased}
    ::-webkit-scrollbar{width:4px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:var(--border);border-radius:2px}
    ::-webkit-scrollbar-thumb:hover{background:var(--surface3)}
    input,select,textarea,button{font-family:inherit}
    @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.35}}
    @keyframes slideIndeterminate{
      0%{width:0%;margin-left:0%}
      50%{width:60%;margin-left:20%}
      100%{width:0%;margin-left:100%}
    }
    @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
    @keyframes landingFadeUp{from{opacity:0;transform:translateY(32px)}to{opacity:1;transform:translateY(0)}}
    @keyframes float{0%,100%{transform:translateY(0px) rotateX(0deg)}50%{transform:translateY(-14px) rotateX(4deg)}}
    @keyframes spinSlow{from{transform:rotateY(0deg)}to{transform:rotateY(360deg)}}
    @keyframes shimmer{0%{background-position:200% center}100%{background-position:-200% center}}
    @keyframes orbitA{from{transform:rotateZ(0deg) translateX(110px) rotateZ(0deg)}to{transform:rotateZ(360deg) translateX(110px) rotateZ(-360deg)}}
    @keyframes orbitB{from{transform:rotateZ(120deg) translateX(160px) rotateZ(-120deg)}to{transform:rotateZ(480deg) translateX(160px) rotateZ(-480deg)}}
    @keyframes orbitC{from{transform:rotateZ(240deg) translateX(210px) rotateZ(-240deg)}to{transform:rotateZ(600deg) translateX(210px) rotateZ(-600deg)}}
    @keyframes ringRotA{from{transform:rotateX(70deg) rotateZ(0deg)}to{transform:rotateX(70deg) rotateZ(360deg)}}
    @keyframes ringRotB{from{transform:rotateX(70deg) rotateZ(60deg)}to{transform:rotateX(70deg) rotateZ(420deg)}}
    @keyframes ringRotC{from{transform:rotateX(70deg) rotateZ(120deg)}to{transform:rotateX(70deg) rotateZ(480deg)}}
    @keyframes glowPulse{0%,100%{box-shadow:0 0 40px rgba(194,105,42,0.12),0 0 80px rgba(194,105,42,0.04)}50%{box-shadow:0 0 60px rgba(194,105,42,0.22),0 0 120px rgba(194,105,42,0.08)}}
    select option{background:#ffffff;color:#141210;font-family:'DM Sans',sans-serif}
    button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  `

  return (
    <>
      <style>{globalCss}</style>
      {page==='landing' && <LandingPage onEnter={()=>setPage('dashboard')}/>}
      {page!=='landing' && (
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
              previewData={previewData}
              onRun={runSimulation} onCancel={cancelSimulation}
            />
          )}
          {page==='library'&&<LibraryPage simulations={simulations} onOpen={openSim}/>}
          {page==='settings'&&<SettingsPage settings={settings} setSettings={setSettings} mode={mode} setMode={setMode}/>}
        </div>
      </div>
      )}
    </>
  )
}
