"use strict";Object.defineProperties(exports,{__esModule:{value:!0},[Symbol.toStringTag]:{value:"Module"}});const e=require("solid-js/web"),G=require("@opencode/plugin/gui"),r=require("solid-js"),Ue=require("@opencode/plugin/rpc"),Ge={type:"object",properties:{},additionalProperties:!1},V={type:"object",additionalProperties:!0};function Q(n,t=[]){return{type:"object",properties:n,...t.length>0?{required:[...t]}:{},additionalProperties:!1}}const B={type:"string"},ae={type:"number"},Ve={type:"array",items:B},He="conductor",Qe=Ue.Rpc.define({id:He,methods:{workspace:{input:Ge,output:V},runs:{input:Q({limit:ae,cursor:B,states:Ve},[]),output:V},run:{input:Q({runId:B},["runId"]),output:V},dag:{input:Q({runId:B},["runId"]),output:V},gates:{input:Q({runId:B},["runId"]),output:V},refinements:{input:Q({runId:B},["runId"]),output:V},memory:{input:Q({limit:ae},[]),output:V},memoryBlock:{input:Q({label:B,version:ae},["label"]),output:V},routing:{input:Q({runId:B},[]),output:V},timeline:{input:Q({runId:B,afterSequence:ae,limit:ae},["runId"]),output:V}},events:{}});function W(n){return typeof n=="object"&&n!==null&&!Array.isArray(n)}function Be(n){if(n==null)return{data:null,error:"empty response"};if(W(n)){if(n.ok===!1){const t=W(n.error)?n.error:null,i=t&&typeof t.message=="string"&&t.message?t.message:"request failed";return{data:null,error:`${t&&typeof t.code=="string"&&t.code?`${t.code}: `:""}${i}`}}if(n.ok===!0&&"data"in n)return{data:n.data,error:null}}return{data:n,error:null}}function M(n){return Array.isArray(n)?n:[]}function We(n){return W(n)?n:{}}function g(n,t="unknown"){return typeof n=="string"&&n.length>0?n:typeof n=="number"&&Number.isFinite(n)||typeof n=="boolean"?String(n):t}const Ye=["openQuestions","open_questions","questions","open"],Ke=["contract","refinement","requirements"];function Je(n){if(typeof n=="string")return n;if(!W(n))return"";const t=n;for(const i of["question","title","text","prompt"]){const s=t[i];if(typeof s=="string"&&s.length>0)return s}return""}function Xe(n){if(!W(n))return!1;const t=n.answer;return typeof t=="string"?t.trim().length>0:!1}function ye(n,t){const i=[];for(const s of M(n)){if(!t&&Xe(s))continue;const $=Je(s);$&&i.push($)}return i}function Te(n){if(Array.isArray(n))return ye(n,!0);if(!W(n))return[];for(const t of Ye){const i=n[t];if(!Array.isArray(i))continue;const s=ye(i,t==="openQuestions"||t==="open_questions");if(s.length>0)return s}for(const t of Ke){const i=n[t];if(!W(i))continue;const s=Te(i);if(s.length>0)return s}return[]}const Ze={pending:"pending",queued:"pending",planned:"pending",todo:"pending",ready:"ready",running:"running",in_progress:"running",inprogress:"running",leased:"running",claimed:"running",dispatched:"running",completed:"completed",complete:"completed",succeeded:"completed",success:"completed",passed:"completed",done:"completed",approved:"completed",failed:"failed",failure:"failed",error:"failed",rejected:"failed",declined:"failed",cancelled:"failed",blocked:"blocked",waiting:"blocked",interrupted:"blocked",skipped:"unknown"};function X(n){return typeof n!="string"||n.length===0?"unknown":Ze[n.toLowerCase()]??"unknown"}function et(n){if(typeof n!="string")return"unknown";const t=n.toLowerCase();return t==="approved"||t==="pass"||t==="passed"||t==="allow"?"completed":t==="rejected"||t==="denied"||t==="fail"||t==="failed"?"failed":t==="pending"||t==="requested"?"pending":X(t)}function te(n,t){return typeof n!="string"||t<=0?"":n.length<=t?n:`${n.slice(0,Math.max(0,t-1)).trimEnd()}…`}const ie=1e3,Z=60*ie,ee=60*Z,me=24*ee;function Ie(n,t=Date.now()){if(typeof n!="string"||n.length===0)return"unknown";const i=Date.parse(n);if(Number.isNaN(i))return"unknown";const s=Math.max(0,t-i);return s<45*ie?"just now":s<ee?`${Math.floor(s/Z)}m ago`:s<me?`${Math.floor(s/ee)}h ago`:s<7*me?`${Math.floor(s/me)}d ago`:n.slice(0,10)}function ve(n){return typeof n!="string"||n.length===0||Number.isNaN(Date.parse(n))?"unknown":n.slice(0,16).replace("T"," ")}function tt(n){return typeof n!="string"||n.length===0||Number.isNaN(Date.parse(n))?"unknown":n.slice(0,10)}function Pe(n){if(typeof n!="number"||!Number.isFinite(n)||n<0)return"unknown";if(n<ie)return`${Math.round(n)}ms`;if(n<Z)return`${(n/ie).toFixed(1)}s`;if(n<ee){const s=Math.floor(n/Z),$=Math.floor(n%Z/ie);return`${s}m ${String($).padStart(2,"0")}s`}const t=Math.floor(n/ee),i=Math.floor(n%ee/Z);return`${t}h ${String(i).padStart(2,"0")}m`}function xe(n){return typeof n!="number"||!Number.isFinite(n)?null:n.toLocaleString("en-US")}function _e(n,t){if(typeof n!="number"||!Number.isFinite(n))return null;const i=typeof t=="string"&&t.length>0?t.toUpperCase():"USD",s=Math.abs(n)>0&&Math.abs(n)<.01?4:2;try{return new Intl.NumberFormat("en-US",{style:"currency",currency:i,maximumFractionDigits:s}).format(n)}catch{return`${n.toFixed(s)} ${i}`}}function nt(n){return typeof n!="number"||!Number.isFinite(n)?"unknown":n>=0&&n<=1?`${Math.round(n*100)}%`:String(n)}function rt(n,t){const i=n??{},s=typeof i.completed=="number"&&Number.isFinite(i.completed)?i.completed:0,$=Object.values(i).reduce((o,m)=>typeof m=="number"&&Number.isFinite(m)?o+m:o,0),y=typeof t=="number"&&Number.isFinite(t)&&t>0?t:$,x=y>0?Math.min(100,Math.round(s/y*100)):0;return{completed:s,total:y,percent:x}}const le={nodeWidth:168,nodeHeight:46,columnGap:12,layerGap:36};function se(n,t){return typeof n=="number"&&Number.isFinite(n)&&n>0?n:t}function K(n){return Math.round(n*10)/10}function ot(n,t=[],i={}){const s={nodeWidth:se(i.nodeWidth,le.nodeWidth),nodeHeight:se(i.nodeHeight,le.nodeHeight),columnGap:se(i.columnGap,le.columnGap),layerGap:se(i.layerGap,le.layerGap)},$=new Set,y=[];for(const c of Array.isArray(n)?n:[]){const p=[];for(const f of Array.isArray(c)?c:[])typeof f!="string"||f.length===0||$.has(f)||($.add(f),p.push(f));p.length>0&&y.push(p)}const x=t.filter(c=>typeof c=="string"&&c.length>0&&!$.has(c));if(x.length>0){y.push(x);for(const c of x)$.add(c)}const o=[],m={};let l=0;y.forEach((c,p)=>{const f=c.length*s.nodeWidth+Math.max(0,c.length-1)*s.columnGap;l=Math.max(l,f),c.forEach((w,d)=>{const h={id:w,layer:p,column:d,x:d*(s.nodeWidth+s.columnGap),y:p*(s.nodeHeight+s.layerGap),width:s.nodeWidth,height:s.nodeHeight};o.push(h),m[w]=h})});const a=y.length,u=a===0?0:a*s.nodeHeight+(a-1)*s.layerGap;return{nodes:o,byId:m,width:l,height:u,layerCount:a,unplaced:x}}function at(n,t){const i=n.x+n.width/2,s=n.y+n.height,$=t.x+t.width/2,y=t.y,x=Math.max(16,Math.abs(y-s)/2);return[`M ${K(i)} ${K(s)}`,`C ${K(i)} ${K(s+x)},`,`${K($)} ${K(y-x)},`,`${K($)} ${K(y)}`].join(" ")}var it=e.template("<span class=cdt-badge>"),lt=e.template("<div class=cdt-empty><span class=cdt-empty-title>"),st=e.template("<span class=cdt-empty-body>"),dt=e.template("<div class=cdt-empty role=status aria-live=polite><span class=cdt-empty-body>"),ct=e.template('<section class=cdt-section><div class="cdt-row cdt-between"><h2 class=cdt-heading>');function L(n){return(()=>{var t=it();return e.insert(t,()=>n.label),e.effect(i=>{var s=n.tone??"unknown",$=n.title??n.label;return s!==i.e&&e.setAttribute(t,"data-tone",i.e=s),$!==i.t&&e.setAttribute(t,"title",i.t=$),i},{e:void 0,t:void 0}),t})()}function Y(n){return(()=>{var t=lt(),i=t.firstChild;return e.insert(i,()=>n.title),e.insert(t,(()=>{var s=e.memo(()=>!!n.body);return()=>s()?(()=>{var $=st();return e.insert($,()=>n.body),$})():null})(),null),t})()}function ne(n){return(()=>{var t=dt(),i=t.firstChild;return e.insert(i,()=>n.label),t})()}function re(n){return(()=>{var t=ct(),i=t.firstChild,s=i.firstChild;return e.insert(s,()=>n.title),e.insert(i,()=>n.aside,null),e.insert(t,()=>n.children,null),t})()}var ut=e.template("<p class=cdt-error>: <span class=cdt-mono>"),mt=e.template('<p class="cdt-muted cdt-meta">: <span class=cdt-mono>'),gt=e.template("<div class=cdt-dag-canvas role=group><div class=cdt-dag-inner><svg class=cdt-dag-edges aria-hidden=true>"),pt=e.template("<svg><path class=cdt-dag-edge></svg>",!1,!0,!1),ht=e.template("<button type=button class=cdt-dag-node><span class=cdt-dag-title></span><span class=cdt-dag-meta>"),ft=e.template('<p class="cdt-muted cdt-meta">'),bt=e.template("<span class=cdt-chips>"),vt=e.template('<div class=cdt-card><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span><span class="cdt-row cdt-gap"></span></div><dl class=cdt-kv><dt></dt><dd></dd><dt></dt><dd class=cdt-mono></dd><dt></dt><dd></dd><dt></dt><dd> / </dd><dt></dt><dd>'),$t=e.template("<span class=cdt-muted>"),wt=e.template("<span class=cdt-chip>");function yt(n){const t=G.usePlugin(),[i,s]=r.createSignal(null),$=r.createMemo(()=>M(n.data?.nodes)),y=r.createMemo(()=>new Map($().map(l=>[l.id,l]))),x=r.createMemo(()=>ot(n.data?.layers,$().map(l=>l.id))),o=r.createMemo(()=>{const l=x().byId;return M(n.data?.edges).flatMap(a=>{const u=l[a.from],c=l[a.to];return!u||!c?[]:[{key:`${a.from}->${a.to}`,path:at(u,c),resolved:a.resolved!==!1}]})}),m=r.createMemo(()=>{const l=i();return l?y().get(l)??null:null});return r.createEffect(()=>{const l=i();l&&!y().has(l)&&s(null)}),e.createComponent(re,{get title(){return t.t("dag.title")},get children(){return e.createComponent(r.Show,{get when(){return n.hasRun},get fallback(){return e.createComponent(Y,{get title(){return t.t("runs.noSelection")},get body(){return t.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return n.data},get fallback(){return e.memo(()=>!!n.loading)()?e.createComponent(ne,{get label(){return t.t("common.loading")}}):null},get children(){return e.createComponent(r.Show,{get when(){return x().nodes.length>0},get fallback(){return e.createComponent(Y,{get title(){return t.t("dag.empty.title")},get body(){return t.t("dag.empty.body")}})},get children(){return[e.createComponent(r.Show,{get when(){return M(n.data?.cycles).length>0},get children(){var l=ut(),a=l.firstChild,u=a.nextSibling;return e.insert(l,()=>t.t("dag.cycles"),a),e.insert(u,()=>M(n.data?.cycles).map(c=>c.join(" → ")).join("; ")),l}}),e.createComponent(r.Show,{get when(){return M(n.data?.dangling).length>0},get children(){var l=mt(),a=l.firstChild,u=a.nextSibling;return e.insert(l,()=>t.t("dag.dangling"),a),e.insert(u,()=>M(n.data?.dangling).join(", ")),l}}),(()=>{var l=gt(),a=l.firstChild,u=a.firstChild;return e.insert(u,e.createComponent(r.For,{get each(){return o()},children:c=>(()=>{var p=pt();return e.effect(f=>{var w=c.resolved?"true":"false",d=c.path;return w!==f.e&&e.setAttribute(p,"data-resolved",f.e=w),d!==f.t&&e.setAttribute(p,"d",f.t=d),f},{e:void 0,t:void 0}),p})()})),e.insert(a,e.createComponent(r.For,{get each(){return x().nodes},children:c=>{const p=()=>y().get(c.id),f=()=>g(p()?.state,t.t("common.unknown")),w=()=>[p()?.role,p()?.modelSlot].map(d=>g(d,"")).filter(d=>d.length>0).join(" · ");return(()=>{var d=ht(),h=d.firstChild,_=h.nextSibling;return d.$$click=()=>s(c.id),e.insert(h,()=>g(p()?.title,c.id)),e.insert(_,()=>w()||c.id),e.effect(b=>{var k=X(p()?.state),q=p()?.ghost?"true":"false",v=i()===c.id,S=`${g(p()?.title,c.id)}, ${f()}${w()?`, ${w()}`:""}`,T=`${c.x}px`,I=`${c.y}px`,A=`${c.width}px`,F=`${c.height}px`;return k!==b.e&&e.setAttribute(d,"data-tone",b.e=k),q!==b.t&&e.setAttribute(d,"data-ghost",b.t=q),v!==b.a&&e.setAttribute(d,"aria-pressed",b.a=v),S!==b.o&&e.setAttribute(d,"aria-label",b.o=S),T!==b.i&&e.setStyleProperty(d,"left",b.i=T),I!==b.n&&e.setStyleProperty(d,"top",b.n=I),A!==b.s&&e.setStyleProperty(d,"width",b.s=A),F!==b.h&&e.setStyleProperty(d,"height",b.h=F),b},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0,s:void 0,h:void 0}),d})()}}),null),e.effect(c=>{var p=t.t("dag.title"),f=`${x().width}px`,w=`${x().height}px`,d=x().width,h=x().height;return p!==c.e&&e.setAttribute(l,"aria-label",c.e=p),f!==c.t&&e.setStyleProperty(a,"width",c.t=f),w!==c.a&&e.setStyleProperty(a,"height",c.a=w),d!==c.o&&e.setAttribute(u,"width",c.o=d),h!==c.i&&e.setAttribute(u,"height",c.i=h),c},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0}),l})(),e.createComponent(r.Show,{get when(){return m()},get fallback(){return(()=>{var l=ft();return e.insert(l,()=>t.t("dag.hint")),l})()},children:l=>(()=>{var a=vt(),u=a.firstChild,c=u.firstChild,p=c.nextSibling,f=u.nextSibling,w=f.firstChild,d=w.nextSibling,h=d.nextSibling,_=h.nextSibling,b=_.nextSibling,k=b.nextSibling,q=k.nextSibling,v=q.nextSibling,S=v.firstChild,T=v.nextSibling,I=T.nextSibling;return e.insert(c,()=>g(l().title,l().id)),e.insert(p,e.createComponent(r.Show,{get when(){return l().ghost},get children(){return e.createComponent(L,{tone:"pending",get label(){return t.t("dag.ghost")}})}}),null),e.insert(p,e.createComponent(L,{get tone(){return X(l().state)},get label(){return g(l().state,t.t("common.unknown"))}}),null),e.insert(w,()=>t.t("dag.role")),e.insert(d,()=>g(l().role,t.t("common.unknown"))),e.insert(h,()=>t.t("dag.model")),e.insert(_,()=>g(l().modelSlot,t.t("common.unknown"))),e.insert(b,()=>t.t("dag.attempts")),e.insert(k,()=>g(l().attempts,"0")),e.insert(q,()=>t.t("dag.layer")),e.insert(v,()=>g(l().layer,"0"),S),e.insert(v,()=>g(n.data?.maxDepth,"0"),null),e.insert(T,()=>t.t("dag.dependencies")),e.insert(I,e.createComponent(r.Show,{get when(){return M(l().dependencies).length>0},get fallback(){return(()=>{var A=$t();return e.insert(A,()=>t.t("dag.noDependencies")),A})()},get children(){var A=bt();return e.insert(A,e.createComponent(r.For,{get each(){return M(l().dependencies)},children:F=>(()=>{var U=wt();return e.insert(U,F),U})()})),A}})),a})()})]}})}})}})}})}e.delegateEvents(["click"]);var Ce=e.template("<ul class=cdt-list>"),xt=e.template("<section class=cdt-section><h3 class=cdt-heading>"),_t=e.template("<section class=cdt-section><h3 class=cdt-heading></h3><ul class=cdt-list>"),ge=e.template('<p class="cdt-muted cdt-meta">'),Se=e.template("<span aria-hidden=true>&middot;"),ke=e.template("<span>"),Ct=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"><span>: </span><span aria-hidden=true>&middot;</span><time>'),St=e.template("<span class=cdt-label>"),kt=e.template('<li class=cdt-card><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"></div><span class=cdt-label>'),Mt=e.template('<span class="cdt-mono cdt-muted">'),At=e.template('<li class=cdt-verify><code class=cdt-command></code><div class="cdt-row cdt-wrap cdt-meta"><span class=cdt-muted></span><span class=cdt-muted>'),Rt=e.template("<span class=cdt-mono>"),qt=e.template("<p class=cdt-evidence>"),Nt=e.template("<p class=cdt-required><span class=cdt-label>"),Ft=e.template('<div class=cdt-finding><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-meta cdt-muted"> · ');function Tt(n){const t=G.usePlugin(),i=()=>M(n.data?.approvals),s=()=>M(n.data?.tasks),$=y=>typeof y!="boolean"?t.t("gates.notRun"):y?t.t("gates.passed"):t.t("gates.failed");return e.createComponent(re,{get title(){return t.t("gates.title")},get aside(){return e.createComponent(r.Show,{get when(){return n.data},get children(){return e.createComponent(L,{get tone(){return n.data?.mergeReady?"completed":"blocked"},get label(){return e.memo(()=>!!n.data?.mergeReady)()?t.t("gates.mergeReady"):t.t("gates.mergeBlocked")}})}})},get children(){return e.createComponent(r.Show,{get when(){return n.hasRun},get fallback(){return e.createComponent(Y,{get title(){return t.t("runs.noSelection")},get body(){return t.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return n.data},get fallback(){return e.memo(()=>!!n.loading)()?e.createComponent(ne,{get label(){return t.t("common.loading")}}):null},get children(){return e.createComponent(r.Show,{get when(){return i().length>0||s().length>0},get fallback(){return e.createComponent(Y,{get title(){return t.t("gates.empty.title")},get body(){return t.t("gates.empty.body")}})},get children(){return[(()=>{var y=xt(),x=y.firstChild;return e.insert(x,()=>t.t("gates.approvals")),e.insert(y,e.createComponent(r.Show,{get when(){return i().length>0},get fallback(){return(()=>{var o=ge();return e.insert(o,()=>t.t("gates.noApprovals")),o})()},get children(){var o=Ce();return e.insert(o,e.createComponent(r.For,{get each(){return i()},children:m=>(()=>{var l=Ct(),a=l.firstChild,u=a.firstChild,c=a.nextSibling,p=c.firstChild,f=p.firstChild,w=p.nextSibling,d=w.nextSibling;return e.insert(u,()=>g(m.gate,t.t("common.unknown"))),e.insert(a,e.createComponent(L,{get tone(){return et(m.decision)},get label(){return g(m.decision,t.t("common.unknown"))}}),null),e.insert(p,()=>t.t("gates.actor"),f),e.insert(p,()=>g(m.actor,t.t("common.unknown")),null),e.insert(d,()=>ve(m.createdAt)),e.insert(c,e.createComponent(r.Show,{get when(){return m.expiresAt},get children(){return[Se(),(()=>{var h=ke();return e.insert(h,()=>t.t("gates.expires",{when:ve(m.expiresAt)})),h})()]}}),null),e.effect(()=>e.setAttribute(d,"datetime",g(m.createdAt,""))),l})()})),o}}),null),e.effect(()=>e.setAttribute(y,"aria-label",t.t("gates.approvals"))),y})(),(()=>{var y=_t(),x=y.firstChild,o=x.nextSibling;return e.insert(x,()=>t.t("gates.verification")),e.insert(o,e.createComponent(r.For,{get each(){return s()},children:m=>{const l=()=>M(m.verifications),a=()=>M(m.findings);return(()=>{var u=kt(),c=u.firstChild,p=c.firstChild,f=c.nextSibling,w=f.nextSibling;return e.insert(p,()=>g(m.title,m.taskId)),e.insert(c,e.createComponent(L,{get tone(){return X(m.state)},get label(){return g(m.state,t.t("common.unknown"))}}),null),e.insert(f,e.createComponent(r.Show,{get when(){return typeof m.attemptNo=="number"},get children(){return[(()=>{var d=ke();return e.insert(d,()=>t.t("gates.attempt",{no:g(m.attemptNo,"0")})),d})(),Se()]}}),null),e.insert(f,e.createComponent(L,{get tone(){return e.memo(()=>typeof m.passed=="boolean")()?m.passed?"completed":"failed":"pending"},get label(){return $(m.passed)}}),null),e.insert(f,e.createComponent(r.Show,{get when(){return m.blockingFindings>0},get children(){return e.createComponent(L,{tone:"failed",get label(){return`${g(m.blockingFindings,"0")} ${t.t("gates.blocking")}`}})}}),null),e.insert(f,e.createComponent(r.Show,{get when(){return m.openFindings>0},get children(){return e.createComponent(L,{tone:"pending",get label(){return`${g(m.openFindings,"0")} ${t.t("gates.open")}`}})}}),null),e.insert(w,()=>t.t("gates.verification")),e.insert(u,e.createComponent(r.Show,{get when(){return l().length>0},get fallback(){return(()=>{var d=ge();return e.insert(d,()=>t.t("gates.noVerifications")),d})()},get children(){var d=Ce();return e.insert(d,e.createComponent(r.For,{get each(){return l()},children:h=>(()=>{var _=At(),b=_.firstChild,k=b.nextSibling,q=k.firstChild,v=q.nextSibling;return e.insert(b,()=>g(h.command,t.t("common.unknown"))),e.insert(k,e.createComponent(L,{get tone(){return h.passed?"completed":"failed"},get label(){return e.memo(()=>!!h.passed)()?t.t("gates.passed"):t.t("gates.failed")}}),q),e.insert(q,()=>t.t("gates.exit",{code:g(h.exitCode,"?")})),e.insert(v,()=>Pe(h.durationMs)),e.insert(k,e.createComponent(r.Show,{get when(){return h.outputHash},get children(){var S=Mt();return e.insert(S,()=>te(h.outputHash,12)),e.effect(()=>e.setAttribute(S,"title",h.outputHash)),S}}),null),e.effect(()=>e.setAttribute(b,"title",h.command)),_})()})),d}}),null),e.insert(u,e.createComponent(r.Show,{get when(){return a().length>0},get children(){return[(()=>{var d=St();return e.insert(d,()=>t.t("gates.findings")),d})(),e.createComponent(r.For,{get each(){return a()},children:d=>(()=>{var h=Ft(),_=h.firstChild,b=_.firstChild,k=_.nextSibling,q=k.firstChild;return e.insert(b,()=>g(d.title,t.t("common.unknown"))),e.insert(_,e.createComponent(L,{get tone(){return d.blocking?"failed":"pending"},get label(){return g(d.severity,t.t("common.unknown"))}}),null),e.insert(k,()=>g(d.category,t.t("common.unknown")),q),e.insert(k,()=>g(d.status,t.t("common.unknown")),null),e.insert(k,e.createComponent(r.Show,{get when(){return d.location},get children(){return[" · ",(()=>{var v=Rt();return e.insert(v,()=>d.location),v})()]}}),null),e.insert(h,e.createComponent(r.Show,{get when(){return d.evidence},get children(){var v=qt();return e.insert(v,()=>te(d.evidence,260)),v}}),null),e.insert(h,e.createComponent(r.Show,{get when(){return d.requiredFix},get children(){var v=Nt(),S=v.firstChild;return e.insert(S,()=>t.t("gates.requiredFix")),e.insert(v,()=>d.requiredFix,null),v}}),null),e.effect(()=>e.setAttribute(h,"data-blocking",d.blocking?"true":"false")),h})()})]}}),null),e.insert(u,e.createComponent(r.Show,{get when(){return a().length===0},get children(){var d=ge();return e.insert(d,()=>t.t("gates.noFindings")),d}}),null),u})()}})),e.effect(()=>e.setAttribute(y,"aria-label",t.t("gates.verification"))),y})()]}})}})}})}})}var It=e.template("<ul class=cdt-list>"),Pt=e.template('<span class="cdt-muted cdt-meta">'),Et=e.template("<span class=cdt-memory-preview>"),Dt=e.template("<div class=cdt-memory-content>"),zt=e.template('<li><button type=button class=cdt-memory><span class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span><span class="cdt-row cdt-gap"><span class="cdt-mono cdt-muted cdt-meta"></span></span></span><span class="cdt-row cdt-wrap cdt-meta cdt-muted"><span>: </span><span aria-hidden=true>&middot;</span><span>: </span><span aria-hidden=true>&middot;</span><span></span></span><span class=cdt-label>'),Me=e.template('<p class="cdt-muted cdt-meta">'),Ot=e.template("<pre class=cdt-pre tabindex=0>");function Ae(n){return`${n.label}@${n.version}`}function jt(n){const t=G.usePlugin(),[i,s]=r.createSignal(null),[$,y]=r.createSignal({}),[x,o]=r.createSignal(null),m=()=>M(n.data?.blocks);async function l(a){const u=Ae(a);if(i()===u){s(null);return}if(s(u),Object.prototype.hasOwnProperty.call($(),u))return;o(u);const c=await n.loadBlock(g(a.label,""),a.version);o(p=>p===u?null:p),y(p=>({...p,[u]:c}))}return e.createComponent(re,{get title(){return t.t("memory.title")},get aside(){return(()=>{var a=Pt();return e.insert(a,()=>t.plural("memory.summary",M(n.data?.blocks).length)),a})()},get children(){return e.createComponent(r.Show,{get when(){return m().length>0},get fallback(){return e.memo(()=>!!n.loading)()?e.createComponent(ne,{get label(){return t.t("common.loading")}}):e.createComponent(Y,{get title(){return t.t("memory.empty.title")},get body(){return t.t("memory.empty.body")}})},get children(){var a=It();return e.insert(a,e.createComponent(r.For,{get each(){return m()},children:(u,c)=>{const p=()=>Ae(u),f=()=>`cdt-memory-content-${c()}`,w=()=>$()[p()];return(()=>{var d=zt(),h=d.firstChild,_=h.firstChild,b=_.firstChild,k=b.nextSibling,q=k.firstChild,v=_.nextSibling,S=v.firstChild,T=S.firstChild,I=S.nextSibling,A=I.nextSibling,F=A.firstChild,U=A.nextSibling,ue=U.nextSibling,J=v.nextSibling;return h.$$click=()=>{l(u)},e.insert(b,()=>g(u.label,t.t("common.unknown"))),e.insert(q,()=>t.t("memory.version",{version:g(u.version,"0")})),e.insert(k,e.createComponent(L,{get tone(){return X(u.status)},get label(){return g(u.status,t.t("common.unknown"))}}),null),e.insert(S,()=>t.t("memory.scope"),T),e.insert(S,()=>g(u.scope,t.t("common.unknown")),null),e.insert(A,()=>t.t("memory.confidence"),F),e.insert(A,()=>nt(u.confidence),null),e.insert(ue,(()=>{var R=e.memo(()=>typeof u.reviewAfter=="string");return()=>R()?t.t("memory.reviewAfter",{when:tt(u.reviewAfter)}):t.t("memory.noReview")})()),e.insert(h,e.createComponent(r.Show,{get when(){return u.contentPreview},get children(){var R=Et();return e.insert(R,()=>te(u.contentPreview,160)),R}}),J),e.insert(J,(()=>{var R=e.memo(()=>i()===p());return()=>R()?t.t("memory.collapse"):t.t("memory.expand")})()),e.insert(d,e.createComponent(r.Show,{get when(){return i()===p()},get children(){var R=Dt();return e.insert(R,e.createComponent(r.Show,{get when(){return x()!==p()},get fallback(){return(()=>{var D=Me();return e.insert(D,()=>t.t("memory.loading")),D})()},get children(){return e.createComponent(r.Show,{get when(){return w()},get fallback(){return(()=>{var D=Me();return e.insert(D,()=>t.t("memory.contentUnavailable")),D})()},children:D=>(()=>{var P=Ot();return e.insert(P,()=>D().content),e.effect(()=>e.setAttribute(P,"aria-label",D().label)),P})()})}})),e.effect(()=>e.setAttribute(R,"id",f())),R}}),null),e.effect(R=>{var D=i()===p(),P=f();return D!==R.e&&e.setAttribute(h,"aria-expanded",R.e=D),P!==R.t&&e.setAttribute(h,"aria-controls",R.t=P),R},{e:void 0,t:void 0}),d})()}})),a}})}})}e.delegateEvents(["click"]);var Re=e.template("<dt>"),Lt=e.template("<dd>"),Ut=e.template("<dd class=cdt-mono>"),Gt=e.template("<dl class=cdt-kv><dt></dt><dd>"),de=e.template("<span class=cdt-label>"),pe=e.template("<ul class=cdt-list>"),Vt=e.template("<pre class=cdt-pre tabindex=0>"),ce=e.template('<p class="cdt-muted cdt-meta">'),qe=e.template('<li class="cdt-card cdt-card-tight">'),Ht=e.template("<li class=cdt-qa><div class=cdt-qa-question><span class=cdt-muted>: </span></div><p class=cdt-qa-answer><span class=cdt-muted>: ");function Qt(n){const t=G.usePlugin(),i=()=>g(n.data?.state,t.t("common.unknown")),s=()=>M(n.data?.uncertainties),$=()=>M(n.data?.qaPairs).filter(o=>g(o.question,"").length>0||g(o.answer,"").length>0),y=()=>Te(n.data?.contract),x=()=>g(n.data?.requirementsMarkdown,"");return e.createComponent(re,{get title(){return t.t("refinements.title")},get aside(){return e.createComponent(L,{get tone(){return X(n.data?.state)},get label(){return i()}})},get children(){return e.createComponent(r.Show,{get when(){return n.hasRun},get fallback(){return e.createComponent(Y,{get title(){return t.t("runs.noSelection")},get body(){return t.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return n.data},get fallback(){return e.memo(()=>!!n.loading)()?e.createComponent(ne,{get label(){return t.t("common.loading")}}):null},get children(){return[e.createComponent(r.Show,{get when(){return n.data?.state!=="none"},get children(){var o=Gt(),m=o.firstChild,l=m.nextSibling;return e.insert(m,()=>t.t("refinements.state")),e.insert(l,i),e.insert(o,e.createComponent(r.Show,{get when(){return n.data?.outcome},get children(){return[(()=>{var a=Re();return e.insert(a,()=>t.t("refinements.outcome")),a})(),(()=>{var a=Lt();return e.insert(a,()=>g(n.data?.outcome,t.t("common.unknown"))),a})()]}}),null),e.insert(o,e.createComponent(r.Show,{get when(){return n.data?.requirementsPath},get children(){return[(()=>{var a=Re();return e.insert(a,()=>t.t("refinements.source")),a})(),(()=>{var a=Ut();return e.insert(a,()=>g(n.data?.requirementsPath,"")),a})()]}}),null),o}}),e.createComponent(r.Show,{get when(){return s().length>0},get fallback(){return(()=>{var o=ce();return e.insert(o,()=>t.t("refinements.noUncertainties")),o})()},get children(){return[(()=>{var o=de();return e.insert(o,()=>t.t("refinements.uncertainties")),o})(),(()=>{var o=pe();return e.insert(o,e.createComponent(r.For,{get each(){return s()},children:m=>(()=>{var l=qe();return e.insert(l,m),l})()})),o})()]}}),(()=>{var o=de();return e.insert(o,()=>t.t("refinements.qa")),o})(),e.createComponent(r.Show,{get when(){return $().length>0},get fallback(){return(()=>{var o=ce();return e.insert(o,()=>t.t("refinements.noQa")),o})()},get children(){var o=pe();return e.insert(o,e.createComponent(r.For,{get each(){return $()},children:m=>(()=>{var l=Ht(),a=l.firstChild,u=a.firstChild,c=u.firstChild,p=a.nextSibling,f=p.firstChild,w=f.firstChild;return e.insert(u,()=>t.t("refinements.question"),c),e.insert(a,()=>g(m.question,t.t("common.unknown")),null),e.insert(f,()=>t.t("refinements.answer"),w),e.insert(p,()=>g(m.answer,t.t("common.unknown")),null),l})()})),o}}),(()=>{var o=de();return e.insert(o,()=>t.t("refinements.openQuestions")),o})(),e.createComponent(r.Show,{get when(){return y().length>0},get fallback(){return(()=>{var o=ce();return e.insert(o,()=>t.t("refinements.noOpenQuestions")),o})()},get children(){var o=pe();return e.insert(o,e.createComponent(r.For,{get each(){return y()},children:m=>(()=>{var l=qe();return e.insert(l,m),l})()})),o}}),(()=>{var o=de();return e.insert(o,()=>t.t("refinements.requirements")),o})(),e.createComponent(r.Show,{get when(){return x().length>0},get fallback(){return(()=>{var o=ce();return e.insert(o,()=>t.t("refinements.noRequirements")),o})()},get children(){var o=Vt();return e.insert(o,x),e.effect(()=>e.setAttribute(o,"aria-label",t.t("refinements.requirements"))),o}})]}})}})}})}var Bt=e.template("<span class=cdt-muted>"),he=e.template("<ul class=cdt-list>"),Ne=e.template("<section class=cdt-section><h3 class=cdt-heading>"),Wt=e.template("<section class=cdt-section><h3 class=cdt-heading></h3><dl class=cdt-kv><dt></dt><dd></dd><dt></dt><dd></dd><dt></dt><dd>"),Yt=e.template("<ol class=cdt-list>"),Kt=e.template('<section class=cdt-section><div class="cdt-row cdt-between"><h3 class=cdt-heading>'),fe=e.template('<p class="cdt-muted cdt-meta">'),Jt=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span></div><div class="cdt-mono cdt-meta cdt-muted"></div><div class="cdt-meta cdt-muted">: '),Xt=e.template("<span aria-hidden=true>&middot;"),Zt=e.template("<span>"),en=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class=cdt-strong></span><span class="cdt-muted cdt-meta"></span></div><div class="cdt-mono cdt-meta cdt-muted">/</div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"><span></span><span aria-hidden=true>&middot;</span><span> completed</span><span aria-hidden=true>&middot;</span><span> failed'),tn=e.template('<li class="cdt-card cdt-card-tight"><div class="cdt-row cdt-between cdt-gap"><span class="cdt-mono cdt-strong"></span><span class="cdt-muted cdt-meta"></span></div><div class="cdt-row cdt-wrap cdt-meta cdt-muted"><span>: </span><span aria-hidden=true>&middot;</span><span>: '),Fe=e.template("<span class=cdt-mono>"),nn=e.template("<p class=cdt-event-summary>"),rn=e.template('<li class=cdt-event><span class=cdt-event-seq aria-hidden=true></span><div class=cdt-event-body><div class="cdt-row cdt-between cdt-gap"><span class="cdt-strong cdt-mono"></span><time class="cdt-muted cdt-meta"></time></div><div class="cdt-meta cdt-muted">');const on=120;function an(n){const t=G.usePlugin(),i=()=>M(n.data?.assignments),s=()=>M(n.data?.observed),$=()=>M(n.data?.costs.byModel),y=r.createMemo(()=>M(n.timeline?.events).slice().sort((o,m)=>m.sequence-o.sequence).slice(0,on)),x=()=>(()=>{var o=Bt();return e.insert(o,()=>t.t("routing.usageUnavailable")),o})();return e.createComponent(re,{get title(){return t.t("routing.title")},get children(){return e.createComponent(r.Show,{get when(){return n.hasRun},get fallback(){return e.createComponent(Y,{get title(){return t.t("runs.noSelection")},get body(){return t.t("runs.empty.noSelection")}})},get children(){return e.createComponent(r.Show,{get when(){return n.data},get fallback(){return e.memo(()=>!!n.loading)()?e.createComponent(ne,{get label(){return t.t("common.loading")}}):e.createComponent(Y,{get title(){return t.t("routing.empty.title")},get body(){return t.t("routing.empty.body")}})},get children(){return[(()=>{var o=Ne(),m=o.firstChild;return e.insert(m,()=>t.t("routing.assignments")),e.insert(o,e.createComponent(r.Show,{get when(){return i().length>0},get fallback(){return(()=>{var l=fe();return e.insert(l,()=>t.t("routing.noAssignments")),l})()},get children(){var l=he();return e.insert(l,e.createComponent(r.For,{get each(){return i()},children:a=>(()=>{var u=Jt(),c=u.firstChild,p=c.firstChild,f=c.nextSibling,w=f.nextSibling,d=w.firstChild;return e.insert(p,()=>g(a.role,t.t("common.unknown"))),e.insert(c,e.createComponent(r.Show,{get when(){return a.variant},get children(){return e.createComponent(L,{tone:"pending",get label(){return g(a.variant,"")}})}}),null),e.insert(f,()=>g(a.model,t.t("common.unknown"))),e.insert(w,()=>t.t("routing.source"),d),e.insert(w,()=>g(a.source,t.t("common.unknown")),null),u})()})),l}}),null),e.effect(()=>e.setAttribute(o,"aria-label",t.t("routing.assignments"))),o})(),(()=>{var o=Ne(),m=o.firstChild;return e.insert(m,()=>t.t("routing.observed")),e.insert(o,e.createComponent(r.Show,{get when(){return s().length>0},get fallback(){return(()=>{var l=fe();return e.insert(l,()=>t.t("routing.noObserved")),l})()},get children(){var l=he();return e.insert(l,e.createComponent(r.For,{get each(){return s()},children:a=>(()=>{var u=en(),c=u.firstChild,p=c.firstChild,f=p.nextSibling,w=c.nextSibling,d=w.firstChild,h=w.nextSibling,_=h.firstChild,b=_.nextSibling,k=b.nextSibling,q=k.firstChild,v=k.nextSibling,S=v.nextSibling,T=S.firstChild;return e.insert(p,()=>g(a.role,t.t("common.unknown"))),e.insert(f,()=>t.t("routing.attempts",{count:g(a.attempts,"0")})),e.insert(w,()=>g(a.modelProvider,t.t("common.unknown")),d),e.insert(w,()=>g(a.modelId,t.t("common.unknown")),null),e.insert(w,e.createComponent(r.Show,{get when(){return a.modelVariant},get children(){return["/",e.memo(()=>g(a.modelVariant,""))]}}),null),e.insert(_,()=>g(a.modelSlot,t.t("common.unknown"))),e.insert(k,()=>g(a.completed,"0"),q),e.insert(S,()=>g(a.failed,"0"),T),e.insert(h,e.createComponent(r.Show,{get when(){return typeof a.avgDurationMs=="number"},get children(){return[Xt(),(()=>{var I=Zt();return e.insert(I,()=>t.t("routing.avgDuration",{duration:Pe(a.avgDurationMs)})),I})()]}}),null),u})()})),l}}),null),e.effect(()=>e.setAttribute(o,"aria-label",t.t("routing.observed"))),o})(),(()=>{var o=Wt(),m=o.firstChild,l=m.nextSibling,a=l.firstChild,u=a.nextSibling,c=u.nextSibling,p=c.nextSibling,f=p.nextSibling,w=f.nextSibling;return e.insert(m,()=>t.t("routing.costs")),e.insert(a,()=>t.t("routing.totalTokens")),e.insert(u,()=>xe(n.data?.costs.totalTokens)??x()),e.insert(c,()=>t.t("routing.totalCost")),e.insert(p,()=>_e(n.data?.costs.totalCost,n.data?.costs.currency)??x()),e.insert(f,()=>t.t("routing.coverage")),e.insert(w,()=>t.t("routing.coverageValue",{withUsage:g(n.data?.costs.coverage.withUsage,"0"),attempts:g(n.data?.costs.coverage.attempts,"0")})),e.insert(o,e.createComponent(r.Show,{get when(){return $().length>0},get children(){var d=he();return e.insert(d,e.createComponent(r.For,{get each(){return $()},children:h=>(()=>{var _=tn(),b=_.firstChild,k=b.firstChild,q=k.nextSibling,v=b.nextSibling,S=v.firstChild,T=S.firstChild,I=S.nextSibling,A=I.nextSibling,F=A.firstChild;return e.insert(k,()=>g(h.model,t.t("common.unknown"))),e.insert(q,()=>t.t("routing.attempts",{count:g(h.attempts,"0")})),e.insert(S,()=>t.t("routing.totalTokens"),T),e.insert(S,()=>xe(h.tokens)??x(),null),e.insert(A,()=>t.t("routing.totalCost"),F),e.insert(A,()=>_e(h.cost,h.currency??n.data?.costs.currency)??x(),null),_})()})),d}}),null),e.effect(()=>e.setAttribute(o,"aria-label",t.t("routing.costs"))),o})(),(()=>{var o=Kt(),m=o.firstChild,l=m.firstChild;return e.insert(l,()=>t.t("routing.timeline")),e.insert(m,e.createComponent(r.Show,{get when(){return n.timeline?.truncated},get children(){return e.createComponent(L,{tone:"pending",get label(){return t.t("routing.truncated")}})}}),null),e.insert(o,e.createComponent(r.Show,{get when(){return y().length>0},get fallback(){return(()=>{var a=fe();return e.insert(a,()=>t.t("routing.noEvents")),a})()},get children(){var a=Yt();return e.insert(a,e.createComponent(r.For,{get each(){return y()},children:u=>(()=>{var c=rn(),p=c.firstChild,f=p.nextSibling,w=f.firstChild,d=w.firstChild,h=d.nextSibling,_=w.nextSibling;return e.insert(p,()=>u.sequence),e.insert(d,()=>g(u.type,t.t("common.unknown"))),e.insert(h,()=>ve(u.createdAt)),e.insert(_,()=>g(u.actor,t.t("common.unknown")),null),e.insert(_,e.createComponent(r.Show,{get when(){return u.taskId},get children(){return[" · ",(()=>{var b=Fe();return e.insert(b,()=>u.taskId),b})()]}}),null),e.insert(_,e.createComponent(r.Show,{get when(){return u.attemptId},get children(){return[" · ",(()=>{var b=Fe();return e.insert(b,()=>te(u.attemptId,18)),b})()]}}),null),e.insert(f,e.createComponent(r.Show,{get when(){return u.summary},get children(){var b=nn();return e.insert(b,()=>te(u.summary,240)),b}}),null),e.effect(()=>e.setAttribute(h,"datetime",g(u.createdAt,""))),c})()})),a}}),null),e.effect(()=>e.setAttribute(o,"aria-label",t.t("routing.timeline"))),o})()]}})}})}})}var ln=e.template("<ul class=cdt-list>"),sn=e.template('<span class="cdt-muted cdt-meta">'),dn=e.template("<span aria-hidden=true>&middot;"),cn=e.template("<span>"),un=e.template('<li><button type=button class=cdt-run><span class="cdt-row cdt-between"><span class=cdt-run-objective></span></span><span class="cdt-row cdt-wrap cdt-meta cdt-muted"><span>: </span><span aria-hidden=true>&middot;</span><span>: </span></span><span class=cdt-progress role=progressbar aria-valuemin=0><span></span></span><span class="cdt-row cdt-between cdt-meta cdt-muted"><span></span><span></span></span><span class="cdt-mono cdt-muted cdt-meta">');function mn(n){const t=G.usePlugin();return e.createComponent(re,{get title(){return t.t("runs.title")},get aside(){return(()=>{var i=sn();return e.insert(i,()=>t.plural("runs.summary",M(n.runs).length)),i})()},get children(){return e.createComponent(r.Show,{get when(){return M(n.runs).length>0},get fallback(){return e.memo(()=>!!n.loading)()?e.createComponent(ne,{get label(){return t.t("common.loading")}}):e.createComponent(Y,{get title(){return t.t("runs.empty.title")},get body(){return t.t("runs.empty.body")}})},get children(){var i=ln();return e.insert(i,e.createComponent(r.For,{get each(){return M(n.runs)},children:s=>{const $=()=>rt(We(s.counts),s.taskCount),y=()=>g(s.objective,s.id);return(()=>{var x=un(),o=x.firstChild,m=o.firstChild,l=m.firstChild,a=m.nextSibling,u=a.firstChild,c=u.firstChild,p=u.nextSibling,f=p.nextSibling,w=f.firstChild,d=a.nextSibling,h=d.firstChild,_=d.nextSibling,b=_.firstChild,k=b.nextSibling,q=_.nextSibling;return o.$$click=()=>n.onSelect(s.id),e.insert(l,y),e.insert(m,e.createComponent(L,{get tone(){return X(s.state)},get label(){return g(s.state,t.t("common.unknown"))}}),null),e.insert(u,()=>t.t("runs.risk"),c),e.insert(u,()=>g(s.riskClass,t.t("common.unknown")),null),e.insert(f,()=>t.t("runs.mode"),w),e.insert(f,()=>g(s.operationMode,t.t("common.unknown")),null),e.insert(a,e.createComponent(r.Show,{get when(){return s.hasReceipt},get children(){return[dn(),(()=>{var v=cn();return e.insert(v,()=>t.t("runs.receipt")),v})()]}}),null),e.insert(b,()=>t.t("runs.progress",{completed:$().completed,total:$().total})),e.insert(k,()=>t.t("runs.updated",{when:Ie(s.updatedAt)})),e.insert(q,()=>s.id),e.effect(v=>{var S=n.selectedId===s.id,T=`${t.t("runs.select")}: ${te(y(),90)}`,I=t.t("runs.progress",{completed:$().completed,total:$().total}),A=$().total,F=$().completed,U=`${$().percent}%`;return S!==v.e&&e.setAttribute(o,"aria-pressed",v.e=S),T!==v.t&&e.setAttribute(o,"aria-label",v.t=T),I!==v.a&&e.setAttribute(d,"aria-label",v.a=I),A!==v.o&&e.setAttribute(d,"aria-valuemax",v.o=A),F!==v.i&&e.setAttribute(d,"aria-valuenow",v.i=F),U!==v.n&&e.setStyleProperty(h,"width",v.n=U),v},{e:void 0,t:void 0,a:void 0,o:void 0,i:void 0,n:void 0}),x})()}})),i}})}})}e.delegateEvents(["click"]);var gn=e.template("<div class=cdt-error role=alert><div></div><div class=cdt-error-detail>"),pn=e.template("<div class=cdt-root><header class=cdt-header><div class=cdt-title></div><div class=cdt-subtitle>"),be=e.template("<span>"),hn=e.template("<span class=cdt-mono>");const Ee=["runs","dag","gates","refinements","memory","routing"];function fn(n){return Ee.find(t=>t===n)??"runs"}const bn=3e3,vn=50,$n=50,wn=200;function yn(n){const t=G.usePlugin(),[i,s]=r.createSignal([]),[$,y]=r.createSignal(null),[x,o]=r.createSignal(null),[m,l]=r.createSignal(null),[a,u]=r.createSignal(null),[c,p]=r.createSignal(null),[f,w]=r.createSignal(null),[d,h]=r.createSignal(null),[_,b]=r.createSignal(null),[k,q]=r.createSignal(!0),[v,S]=r.createSignal(!1),[T,I]=r.createSignal(!0),[A,F]=r.createSignal(null),U=()=>fn(n.tab.id),ue=r.createMemo(()=>i().find(C=>C.id===_())??null),J=()=>_()!==null;let R=!1,D=!1;const P=()=>t.client.rpc(Qe);async function H(C){try{return Be(await C())}catch(z){return{data:null,error:z instanceof Error?z.message:String(z)}}}async function $e(C){S(!0);const[z,O,E,N,j,oe]=await Promise.all([H(()=>P().run({runId:C})),H(()=>P().dag({runId:C})),H(()=>P().gates({runId:C})),H(()=>P().refinements({runId:C})),H(()=>P().routing({runId:C})),H(()=>P().timeline({runId:C,limit:wn}))]);if(R||_()!==C)return;S(!1),z.data&&y(z.data),O.data&&o(O.data),E.data&&l(E.data),N.data&&u(N.data),j.data&&w(j.data),oe.data&&h(oe.data);const je=[z,O,E,N,j,oe].find(Le=>Le.error!==null);F(je?.error??null)}async function De(){const C=await H(()=>P().runs({limit:vn}));if(R)return;if(q(!1),C.error){F(C.error);return}const z=M(C.data?.runs);s(z),F(null);const O=_(),E=O&&z.some(N=>N.id===O)?O:z[0]?.id??null;E!==O?b(E):E&&await $e(E)}async function ze(){const C=await H(()=>P().memory({limit:$n}));R||(I(!1),C.data&&p(C.data),C.error&&F(C.error))}async function we(){if(!(D||R)){D=!0;try{await Promise.all([De(),ze()])}finally{D=!1}}}async function Oe(C,z){if(C.length===0)return null;const O=await H(()=>P().memoryBlock({label:C,version:z}));if(O.error)return F(O.error),null;const E=O.data;return W(E)&&W(E.block)?E.block:E??null}return r.createEffect(()=>{const C=_();C&&$e(C)}),r.createEffect(()=>{we();const C=setInterval(()=>{we()},bn);r.onCleanup(()=>{R=!0,clearInterval(C)})}),(()=>{var C=pn(),z=C.firstChild,O=z.firstChild,E=O.nextSibling;return e.insert(O,()=>t.t("panel.title")),e.insert(E,e.createComponent(r.Show,{get when(){return ue()},get fallback(){return(()=>{var N=be();return e.insert(N,()=>t.t("panel.noRun")),N})()},children:N=>[(()=>{var j=hn();return e.insert(j,()=>N().id),j})()," · ",(()=>{var j=be();return e.insert(j,()=>t.t("runs.updated",{when:Ie(N().updatedAt)})),j})()]}),null),e.insert(E,e.createComponent(r.Show,{get when(){return $()},children:N=>[" · ",(()=>{var j=be();return e.insert(j,()=>t.plural("runs.events",N().eventCount)),j})()]}),null),e.insert(C,e.createComponent(r.Show,{get when(){return A()},get children(){var N=gn(),j=N.firstChild,oe=j.nextSibling;return e.insert(j,()=>t.t("common.error",{message:A()??""})),e.insert(oe,()=>t.t("common.retryHint")),N}}),null),e.insert(C,e.createComponent(r.Switch,{get children(){return[e.createComponent(r.Match,{get when(){return U()==="runs"},get children(){return e.createComponent(mn,{get runs(){return i()},get selectedId(){return _()},get loading(){return k()},onSelect:N=>b(N)})}}),e.createComponent(r.Match,{get when(){return U()==="dag"},get children(){return e.createComponent(yt,{get data(){return x()},get loading(){return v()},get hasRun(){return J()}})}}),e.createComponent(r.Match,{get when(){return U()==="gates"},get children(){return e.createComponent(Tt,{get data(){return m()},get loading(){return v()},get hasRun(){return J()}})}}),e.createComponent(r.Match,{get when(){return U()==="refinements"},get children(){return e.createComponent(Qt,{get data(){return a()},get loading(){return v()},get hasRun(){return J()}})}}),e.createComponent(r.Match,{get when(){return U()==="memory"},get children(){return e.createComponent(jt,{get data(){return c()},get loading(){return T()},loadBlock:Oe})}}),e.createComponent(r.Match,{get when(){return U()==="routing"},get children(){return e.createComponent(an,{get data(){return f()},get timeline(){return d()},get loading(){return v()},get hasRun(){return J()}})}})]}}),null),C})()}const xn=`
.cdt-root {
  --cdt-border: color-mix(in oklab, currentColor 14%, transparent);
  --cdt-border-strong: color-mix(in oklab, currentColor 26%, transparent);
  --cdt-muted: color-mix(in oklab, currentColor 58%, transparent);
  --cdt-surface: color-mix(in oklab, currentColor 4%, transparent);
  --cdt-surface-strong: color-mix(in oklab, currentColor 8%, transparent);
  --cdt-focus: #3b82f6;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 12px;
  box-sizing: border-box;
  overflow: auto;
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  color: inherit;
}
.cdt-root *,
.cdt-root *::before,
.cdt-root *::after {
  box-sizing: border-box;
}
.cdt-root button {
  margin: 0;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.cdt-root :is(button, [tabindex]):focus-visible {
  outline: 2px solid var(--cdt-focus);
  outline-offset: 2px;
  border-radius: 4px;
}

.cdt-header {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--cdt-border);
}
.cdt-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.cdt-subtitle {
  color: var(--cdt-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cdt-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.cdt-section + .cdt-section {
  margin-top: 4px;
}
.cdt-heading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--cdt-muted);
}
.cdt-subheading {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}
.cdt-label {
  display: block;
  margin-top: 2px;
  color: var(--cdt-muted);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.cdt-muted {
  color: var(--cdt-muted);
}
.cdt-strong {
  font-weight: 600;
}
.cdt-mono {
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 0.95em;
}
.cdt-meta {
  font-size: 11px;
}
.cdt-truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cdt-between {
  justify-content: space-between;
}
.cdt-wrap {
  flex-wrap: wrap;
}
.cdt-grow {
  flex: 1 1 auto;
  min-width: 0;
}

.cdt-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.cdt-card {
  padding: 8px 10px;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background: var(--cdt-surface);
}
.cdt-card-tight {
  padding: 6px 8px;
}
.cdt-card + .cdt-card {
  margin-top: 6px;
}

.cdt-badge {
  --cdt-tone: currentColor;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 100%;
  padding: 0 6px;
  border: 1px solid color-mix(in oklab, var(--cdt-tone) 38%, transparent);
  border-radius: 999px;
  background: color-mix(in oklab, var(--cdt-tone) 10%, transparent);
  color: color-mix(in oklab, var(--cdt-tone) 55%, currentColor);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.03em;
  line-height: 16px;
  text-transform: uppercase;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-badge[data-tone="pending"] { --cdt-tone: #9ca3af; }
.cdt-badge[data-tone="ready"] { --cdt-tone: #3b82f6; }
.cdt-badge[data-tone="running"] { --cdt-tone: #f59e0b; }
.cdt-badge[data-tone="completed"] { --cdt-tone: #10b981; }
.cdt-badge[data-tone="failed"] { --cdt-tone: #ef4444; }
.cdt-badge[data-tone="blocked"] { --cdt-tone: #8b5cf6; }
.cdt-badge[data-tone="unknown"] { --cdt-tone: #9ca3af; }

.cdt-dot {
  --cdt-tone: currentColor;
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--cdt-tone);
}
.cdt-dot[data-tone="pending"] { --cdt-tone: #9ca3af; }
.cdt-dot[data-tone="ready"] { --cdt-tone: #3b82f6; }
.cdt-dot[data-tone="running"] { --cdt-tone: #f59e0b; }
.cdt-dot[data-tone="completed"] { --cdt-tone: #10b981; }
.cdt-dot[data-tone="failed"] { --cdt-tone: #ef4444; }
.cdt-dot[data-tone="blocked"] { --cdt-tone: #8b5cf6; }
.cdt-dot[data-tone="unknown"] { --cdt-tone: #9ca3af; }

.cdt-empty {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 18px 12px;
  border: 1px dashed var(--cdt-border);
  border-radius: 8px;
  text-align: center;
}
.cdt-empty-title {
  font-weight: 600;
}
.cdt-empty-body {
  color: var(--cdt-muted);
  font-size: 11px;
}

.cdt-error {
  padding: 6px 8px;
  border: 1px solid color-mix(in oklab, #ef4444 40%, transparent);
  border-radius: 6px;
  background: color-mix(in oklab, #ef4444 9%, transparent);
  color: color-mix(in oklab, #ef4444 45%, currentColor);
  font-size: 11px;
}
.cdt-error-detail {
  color: var(--cdt-muted);
}

.cdt-run {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background: var(--cdt-surface);
  transition: border-color 120ms ease, background-color 120ms ease;
}
.cdt-run:hover {
  border-color: var(--cdt-border-strong);
  background: var(--cdt-surface-strong);
}
.cdt-run[aria-pressed="true"] {
  border-color: color-mix(in oklab, currentColor 42%, transparent);
  background: var(--cdt-surface-strong);
}
.cdt-run-objective {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  font-weight: 600;
  line-height: 1.35;
}

.cdt-progress {
  display: block;
  width: 100%;
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in oklab, currentColor 12%, transparent);
}
.cdt-progress > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in oklab, currentColor 55%, transparent);
}

.cdt-dag-canvas {
  overflow: auto;
  max-height: 46vh;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background:
    radial-gradient(circle at 1px 1px, color-mix(in oklab, currentColor 10%, transparent) 1px, transparent 0)
    0 0 / 14px 14px;
}
.cdt-dag-inner {
  position: relative;
  min-width: 100%;
}
.cdt-dag-edges {
  position: absolute;
  inset: 0;
  overflow: visible;
  pointer-events: none;
}
.cdt-dag-edge {
  fill: none;
  stroke: color-mix(in oklab, currentColor 28%, transparent);
  stroke-width: 1.5;
}
.cdt-dag-edge[data-resolved="false"] {
  stroke-dasharray: 4 4;
}
.cdt-dag-node {
  --cdt-tone: #9ca3af;
  position: absolute;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 1px;
  padding: 4px 7px 4px 9px;
  overflow: hidden;
  border: 1px solid var(--cdt-border);
  border-left: 3px solid var(--cdt-tone);
  border-radius: 6px;
  background: color-mix(in oklab, currentColor 4%, transparent);
  transition: background-color 120ms ease, border-color 120ms ease;
}
.cdt-dag-node:hover {
  background: var(--cdt-surface-strong);
}
.cdt-dag-node[aria-pressed="true"] {
  border-color: color-mix(in oklab, var(--cdt-tone) 60%, var(--cdt-border));
  background: var(--cdt-surface-strong);
}
.cdt-dag-node[data-ghost="true"] {
  border-style: dashed;
  border-left-style: solid;
  opacity: 0.72;
}
.cdt-dag-node[data-tone="pending"] { --cdt-tone: #9ca3af; }
.cdt-dag-node[data-tone="ready"] { --cdt-tone: #3b82f6; }
.cdt-dag-node[data-tone="running"] { --cdt-tone: #f59e0b; }
.cdt-dag-node[data-tone="completed"] { --cdt-tone: #10b981; }
.cdt-dag-node[data-tone="failed"] { --cdt-tone: #ef4444; }
.cdt-dag-node[data-tone="blocked"] { --cdt-tone: #8b5cf6; }
.cdt-dag-node[data-tone="unknown"] { --cdt-tone: #9ca3af; }
.cdt-dag-title {
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.25;
}
.cdt-dag-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--cdt-muted);
  font-size: 10px;
}

.cdt-kv {
  display: grid;
  grid-template-columns: minmax(76px, auto) minmax(0, 1fr);
  gap: 2px 10px;
  margin: 6px 0 0;
}
.cdt-kv > dt {
  color: var(--cdt-muted);
  font-size: 11px;
}
.cdt-kv > dd {
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 11px;
}

.cdt-chip {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 0 5px;
  border: 1px solid var(--cdt-border);
  border-radius: 4px;
  background: var(--cdt-surface);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10px;
  line-height: 16px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.cdt-verify {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 0;
  border-top: 1px solid var(--cdt-border);
}
.cdt-verify:first-child {
  border-top: 0;
  padding-top: 0;
}
.cdt-command {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
}
.cdt-finding {
  padding: 6px 8px;
  border: 1px solid var(--cdt-border);
  border-radius: 6px;
  background: color-mix(in oklab, currentColor 2%, transparent);
}
.cdt-finding[data-blocking="true"] {
  border-color: color-mix(in oklab, #ef4444 45%, transparent);
}
.cdt-finding + .cdt-finding {
  margin-top: 4px;
}
.cdt-evidence,
.cdt-required {
  margin: 3px 0 0;
  font-size: 11px;
  overflow-wrap: anywhere;
}
.cdt-required {
  color: color-mix(in oklab, #f59e0b 45%, currentColor);
}

.cdt-pre {
  max-height: 280px;
  margin: 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid var(--cdt-border);
  border-radius: 6px;
  background: var(--cdt-surface);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.cdt-qa {
  padding: 6px 8px;
  border-left: 2px solid var(--cdt-border-strong);
}
.cdt-qa-question {
  font-weight: 600;
  font-size: 11px;
}
.cdt-qa-answer {
  margin: 2px 0 0;
  color: var(--cdt-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.cdt-memory {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  padding: 7px 9px;
  border: 1px solid var(--cdt-border);
  border-radius: 8px;
  background: var(--cdt-surface);
  transition: background-color 120ms ease, border-color 120ms ease;
}
.cdt-memory:hover {
  background: var(--cdt-surface-strong);
  border-color: var(--cdt-border-strong);
}
.cdt-memory[aria-expanded="true"] {
  border-color: color-mix(in oklab, currentColor 38%, transparent);
}
.cdt-memory-preview {
  color: var(--cdt-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.cdt-memory-content {
  margin-top: 6px;
}

.cdt-event {
  display: flex;
  gap: 8px;
  padding: 5px 0;
  border-top: 1px solid var(--cdt-border);
}
.cdt-event:first-child {
  border-top: 0;
}
.cdt-event-seq {
  flex: 0 0 auto;
  min-width: 26px;
  color: var(--cdt-muted);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 10px;
  text-align: right;
}
.cdt-event-body {
  min-width: 0;
  flex: 1 1 auto;
}
.cdt-event-summary {
  margin: 1px 0 0;
  color: var(--cdt-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.cdt-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .cdt-root * {
    transition: none !important;
  }
}
`,_n={runs:"tab.runs",dag:"tab.dag",gates:"tab.gates",refinements:"tab.refinements",memory:"tab.memory",routing:"tab.routing"},Cn=G.Plugin.define({i18n:{en:{"panel.title":"Conductor","panel.noRun":"No run selected","command.open":"Open Conductor panel","command.description":"Inspect runs, the task graph, gates, refinements, memory and model routing.","tab.runs":"Runs","tab.dag":"DAG","tab.gates":"Gates","tab.refinements":"Refinements","tab.memory":"Memory","tab.routing":"Routing","common.loading":"Loading…","common.unknown":"unknown","common.error":"Could not load data: {{message}}","common.retryHint":"The panel retries every 3 seconds.","runs.title":"Runs","runs.summary.one":"{{count}} run","runs.summary.other":"{{count}} runs","runs.events.one":"{{count}} event","runs.events.other":"{{count}} events","runs.empty.title":"No runs yet","runs.empty.body":"A run appears here once the supervisor starts one in this project.","runs.select":"Select run","runs.risk":"Risk","runs.mode":"Mode","runs.receipt":"receipt","runs.progress":"{{completed}}/{{total}} tasks","runs.updated":"Updated {{when}}","runs.noSelection":"Select a run","runs.empty.noSelection":"Pick a run in the Runs tab to inspect this view.","dag.title":"Task graph","dag.empty.title":"No task graph","dag.empty.body":"This run has no plan or tasks yet.","dag.cycles":"Dependency cycle","dag.dangling":"Unknown dependencies","dag.ghost":"ghost","dag.role":"Role","dag.model":"Model","dag.attempts":"Attempts","dag.layer":"Layer","dag.dependencies":"Dependencies","dag.noDependencies":"No dependencies","dag.hint":"Select a task to see its role, model, attempts and dependencies.","gates.title":"Gates","gates.empty.title":"No gates","gates.empty.body":"This run has no approvals or verification evidence yet.","gates.approvals":"Approvals","gates.noApprovals":"No approvals recorded.","gates.actor":"Actor","gates.expires":"Expires {{when}}","gates.verification":"Verification","gates.noVerifications":"No verification commands recorded.","gates.attempt":"Attempt {{no}}","gates.passed":"passed","gates.failed":"failed","gates.notRun":"not run","gates.exit":"exit {{code}}","gates.findings":"Review findings","gates.noFindings":"No findings.","gates.blocking":"blocking","gates.open":"open","gates.requiredFix":"Required fix","gates.mergeReady":"Merge ready","gates.mergeBlocked":"Merge blocked","refinements.title":"Refinements","refinements.state":"State","refinements.outcome":"Outcome","refinements.source":"Source","refinements.uncertainties":"Uncertainties","refinements.noUncertainties":"No uncertainties recorded.","refinements.qa":"Questions and answers","refinements.noQa":"No questions recorded.","refinements.question":"Question","refinements.answer":"Answer","refinements.openQuestions":"Open questions","refinements.noOpenQuestions":"No open questions.","refinements.requirements":"Requirements","refinements.noRequirements":"No requirements contract.","memory.title":"Memory","memory.summary.one":"{{count}} block","memory.summary.other":"{{count}} blocks","memory.empty.title":"No memory blocks","memory.empty.body":"Project memory appears here once a run records it.","memory.version":"v{{version}}","memory.scope":"Scope","memory.confidence":"Confidence","memory.reviewAfter":"Review after {{when}}","memory.noReview":"No review date","memory.expand":"Show content","memory.collapse":"Hide content","memory.loading":"Loading block…","memory.contentUnavailable":"Content unavailable.","routing.title":"Routing & timeline","routing.empty.title":"No routing data","routing.empty.body":"Routing and events appear after a run starts.","routing.assignments":"Fleet assignments","routing.noAssignments":"No fleet assignments.","routing.source":"Source","routing.observed":"Observed routes","routing.noObserved":"No attempts recorded.","routing.attempts":"{{count}} attempts","routing.avgDuration":"avg {{duration}}","routing.costs":"Cost and usage","routing.totalTokens":"Total tokens","routing.totalCost":"Total cost","routing.coverage":"Usage coverage","routing.coverageValue":"{{withUsage}}/{{attempts}} attempts","routing.usageUnavailable":"usage unavailable","routing.timeline":"Event timeline","routing.truncated":"older events hidden","routing.noEvents":"No events recorded."}},setup(n){const t=Ee.map(i=>({id:i,group:"conductor",closable:"hover",fallback:i==="runs",get title(){return n.t(_n[i])}}));n.add(G.Panel,{id:"conductor",region:"side",wide:!0,mobile:{get title(){return n.t("panel.title")},order:40,kind:"menu",icon:"terminal"},list:()=>t,render:i=>e.createComponent(yn,{get tab(){return i.tab},get session(){return i.session},get screen(){return i.screen}})}),n.add(G.Command,()=>({id:"open",title:n.t("command.open"),description:n.t("command.description"),section:"session",run:()=>{const i=n.sessions.current();i&&n.layout.toggle(`${n.id}:runs`,i)}})),n.add(G.Style,xn)}});exports.default=Cn;
