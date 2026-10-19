import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowLeft,
  ArrowRight,
  Archive,
  BadgeCheck,
  BarChart3,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileDown,
  FileText,
  Filter,
  HeartPulse,
  Home,
  Info,
  LayoutDashboard,
  Menu,
  MoreHorizontal,
  PencilLine,
  Plus,
  Printer,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import checklistTemplates from './checklistData.json';
import './styles.css';

const STORAGE_KEY = 'careaudit-inspections-v1';
const TEMPLATE_ACCENTS = ['aqua', 'gold', 'plum', 'blue', 'coral', 'green', 'indigo'];
const TEMPLATE_MARKS = ['CP', 'DS', '4P', 'MP', 'PT', 'PC', 'OP'];
const DEFAULT_META = {
  facilityName: '',
  facilityAddress: '',
  region: '',
  contact: '',
  ownerName: '',
  headName: '',
  licenseNo: '',
  yearOpened: '',
  inspectionType: 'Routine',
  ownership: 'Private',
  annualLoad: '',
  assessor: '',
  processOwner: '',
  notes: '',
};

function loadRecords() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en', options).format(new Date(value));
}

function formatShortDate(value) {
  return formatDate(value, { month: 'short', day: 'numeric' });
}

function templateAccent(index) {
  return TEMPLATE_ACCENTS[index % TEMPLATE_ACCENTS.length];
}

function createInspection(templateId) {
  const now = new Date().toISOString();
  return {
    id: `inspection-${Date.now()}`,
    templateId,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    currentSection: 0,
    metadata: { ...DEFAULT_META },
    responses: {},
  };
}

function flattenItems(template) {
  return template.sections.flatMap((section) => section.items.map((item) => ({ ...item, sectionId: section.id, sectionTitle: section.title })));
}

function getStats(template, record) {
  const items = flattenItems(template);
  const answered = Object.values(record?.responses || {});
  const hasStatus = (item) => Boolean(record?.responses?.[item.id]?.status);
  const unanswered = items.filter((item) => !item.optional && !hasStatus(item));
  const scoredItems = items.filter((item) => {
    const status = record?.responses?.[item.id]?.status;
    return !item.optional || (status && status !== 'na');
  });
  const scoreValue = (item) => {
    const status = record?.responses?.[item.id]?.status;
    if (status === 'met' || status === 'available') return 1;
    if (status === 'partial') return 0.5;
    return 0;
  };
  const score = scoredItems.length ? Math.round((scoredItems.reduce((sum, item) => sum + scoreValue(item), 0) / scoredItems.length) * 100) : 0;
  const completed = items.filter(hasStatus).length;
  const gaps = items.filter((item) => {
    const status = record?.responses?.[item.id]?.status;
    return status === 'unmet' || status === 'not-available' || (!item.optional && !status);
  });
  const critical = gaps.filter((item) => item.severity === 'critical');
  const major = gaps.filter((item) => item.severity === 'major');
  const sectionStats = template.sections.map((section) => {
    const sectionItems = section.items;
    const sectionAnswered = sectionItems.filter(hasStatus).length;
    const sectionUnanswered = sectionItems.filter((item) => !item.optional && !hasStatus(item)).length;
    const eligible = sectionItems.filter((item) => !item.optional || (record?.responses?.[item.id]?.status && record.responses[item.id].status !== 'na'));
    const sectionScore = eligible.length ? Math.round((eligible.reduce((sum, item) => sum + scoreValue(item), 0) / eligible.length) * 100) : 0;
    return { ...section, total: sectionItems.length, answered: sectionAnswered, unanswered: sectionUnanswered, score: sectionScore };
  });
  return { items, answered: answered.length, completed, total: items.length, unanswered, score, gaps, critical, major, sectionStats };
}

function responseLabel(status, type) {
  if (status === 'met') return 'Met';
  if (status === 'partial') return 'Partially met';
  if (status === 'unmet') return 'Unmet';
  if (status === 'available') return 'Available';
  if (status === 'not-available') return 'Not available';
  if (status === 'na') return 'Not applicable';
  return type === 'availability' ? 'Not assessed' : 'Not assessed';
}

function scoreTone(score) {
  if (score >= 85) return 'strong';
  if (score >= 70) return 'watch';
  return 'risk';
}

function IconMark({ template, size = 'medium' }) {
  const index = checklistTemplates.findIndex((item) => item.id === template?.id);
  return <div className={`template-mark ${templateAccent(Math.max(index, 0))} ${size}`} aria-hidden="true">{TEMPLATE_MARKS[Math.max(index, 0)]}</div>;
}

function StatusPill({ status }) {
  if (!status) return <span className="status-pill pending">In progress</span>;
  return <span className={`status-pill ${status === 'completed' ? 'complete' : 'draft'}`}>{status === 'completed' ? 'Completed' : 'Draft'}</span>;
}

function ScoreChip({ score }) {
  return <span className={`score-chip ${scoreTone(score)}`}><span className="score-dot" /> {score}%</span>;
}

function getInitialRoute() {
  const pathname = window.location.pathname;
  if (pathname === '/library') return { view: 'library', recordId: null };
  if (pathname === '/new') return { view: 'new', recordId: null };
  const match = pathname.match(/^\/(audit|summary|report)\/([^/]+)/);
  if (match) return { view: match[1], recordId: decodeURIComponent(match[2]) };
  return { view: 'dashboard', recordId: null };
}

function App() {
  const [records, setRecords] = useState(loadRecords);
  const initialRoute = useMemo(getInitialRoute, []);
  const [view, setView] = useState(initialRoute.view);
  const [activeRecordId, setActiveRecordId] = useState(initialRoute.recordId);
  const [selectedTemplateId, setSelectedTemplateId] = useState('primary');
  const [librarySearch, setLibrarySearch] = useState('');
  const [mobileMenu, setMobileMenu] = useState(false);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    if (view === 'new' && !activeRecordId) {
      const record = createInspection(selectedTemplateId);
      setRecords((current) => [record, ...current]);
      setActiveRecordId(record.id);
      window.history.replaceState({}, '', `/new`);
    }
  }, [view, activeRecordId, selectedTemplateId]);

  useEffect(() => {
    const handlePopState = () => {
      const nextRoute = getInitialRoute();
      setView(nextRoute.view);
      setActiveRecordId(nextRoute.recordId);
      setMobileMenu(false);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const activeRecord = records.find((record) => record.id === activeRecordId) || null;
  const activeTemplate = checklistTemplates.find((template) => template.id === activeRecord?.templateId) || null;

  const navigate = (nextView, recordId = activeRecordId) => {
    setView(nextView);
    if (recordId !== undefined) setActiveRecordId(recordId);
    setMobileMenu(false);
    const route = nextView === 'dashboard' ? '/' : nextView === 'library' ? '/library' : nextView === 'new' ? '/new' : `/${nextView}/${recordId || ''}`;
    window.history.replaceState({}, '', route);
  };

  const updateRecord = (id, patch) => {
    setRecords((current) => current.map((record) => {
      if (record.id !== id) return record;
      const editingFinalized = record.status === 'completed' && Boolean(patch.responses || patch.metadata || patch.templateId);
      return {
        ...record,
        ...patch,
        ...(editingFinalized ? { status: 'draft', completedAt: null } : {}),
        updatedAt: new Date().toISOString(),
      };
    }));
  };

  const startInspection = (templateId = selectedTemplateId) => {
    const record = createInspection(templateId);
    setRecords((current) => [record, ...current]);
    setActiveRecordId(record.id);
    navigate('new', record.id);
  };

  const openAudit = (recordId, target = 'audit') => {
    const record = records.find((item) => item.id === recordId);
    if (!record) return;
    setActiveRecordId(recordId);
    navigate(target, recordId);
  };

  const removeRecord = (recordId) => {
    setRecords((current) => current.filter((record) => record.id !== recordId));
    if (activeRecordId === recordId) {
      setActiveRecordId(null);
      navigate('dashboard', null);
    }
  };

  const nav = [
    { id: 'dashboard', label: 'Overview', icon: LayoutDashboard },
    { id: 'library', label: 'Checklist library', icon: BookOpen },
  ];
  const recordView = ['audit', 'summary', 'report'].includes(view);

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}>
        <div className="brand-lockup" onClick={() => navigate('dashboard')} role="button" tabIndex="0">
          <div className="brand-symbol"><HeartPulse size={19} strokeWidth={2.4} /></div>
          <div>
            <div className="brand-name">Care<span>Audit</span></div>
            <div className="brand-caption">facility compliance</div>
          </div>
        </div>
        <div className="sidebar-rule" />
        <p className="sidebar-label">Workspace</p>
        <nav className="primary-nav">
          {nav.map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-item ${view === id ? 'active' : ''}`} onClick={() => navigate(id)}>
              <Icon size={17} /> <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-cta">
          <div className="sidebar-cta-kicker"><Sparkles size={14} /> FIELD NOTE</div>
          <p>Keep the visit focused on what changes care.</p>
          <button className="button compact light" onClick={() => startInspection()}><Plus size={15} /> New inspection</button>
        </div>
        <div className="sidebar-footer">
          <ShieldCheck size={15} /> <span>Offline-ready workspace</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="mobile-menu-button" onClick={() => setMobileMenu((open) => !open)} aria-label="Toggle navigation"><Menu size={20} /></button>
          <div className="breadcrumbs">
            <span>CareAudit</span><ChevronRight size={14} />
            <strong>{view === 'dashboard' ? 'Overview' : view === 'library' ? 'Checklist library' : view === 'new' ? 'New inspection' : activeTemplate?.title || 'Inspection'}</strong>
          </div>
          <div className="topbar-actions">
            <span className="save-indicator"><span /> Saved locally</span>
            <button className="avatar-button" title="Local workspace">CA</button>
          </div>
        </header>

        {view === 'dashboard' && <Dashboard records={records} onStart={startInspection} onOpen={openAudit} onRemove={removeRecord} onLibrary={() => navigate('library')} />}
        {view === 'library' && <Library search={librarySearch} setSearch={setLibrarySearch} selectedTemplateId={selectedTemplateId} setSelectedTemplateId={setSelectedTemplateId} onStart={startInspection} />}
        {view === 'new' && activeRecord && activeTemplate && <NewInspection record={activeRecord} template={activeTemplate} selectedTemplateId={selectedTemplateId} setSelectedTemplateId={setSelectedTemplateId} onUpdate={updateRecord} onStart={openAudit} onCancel={() => navigate('dashboard')} />}
        {view === 'audit' && activeRecord && activeTemplate && <AuditWorkspace record={activeRecord} template={activeTemplate} onUpdate={updateRecord} onSummary={() => navigate('summary', activeRecord.id)} onExit={() => navigate('dashboard')} />}
        {view === 'summary' && activeRecord && activeTemplate && <Summary record={activeRecord} template={activeTemplate} onUpdate={updateRecord} onAudit={() => navigate('audit', activeRecord.id)} onReport={() => navigate('report', activeRecord.id)} />}
        {view === 'report' && activeRecord && activeTemplate && activeRecord.status === 'completed' && <Report record={activeRecord} template={activeTemplate} onAudit={() => navigate('audit', activeRecord.id)} onSummary={() => navigate('summary', activeRecord.id)} />}
        {view === 'report' && activeRecord && activeTemplate && activeRecord.status !== 'completed' && <Summary record={activeRecord} template={activeTemplate} onUpdate={updateRecord} onAudit={() => navigate('audit', activeRecord.id)} onReport={() => navigate('report', activeRecord.id)} />}
        {recordView && (!activeRecord || !activeTemplate) && <MissingRecord onHome={() => navigate('dashboard', null)} />}
      </main>
    </div>
  );
}

function PageHeader({ eyebrow, title, description, action }) {
  return <div className="page-header">
    <div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>
    {action && <div className="page-header-action">{action}</div>}
  </div>;
}

function Dashboard({ records, onStart, onOpen, onRemove, onLibrary }) {
  const drafts = records.filter((record) => record.status === 'draft');
  const completed = records.filter((record) => record.status === 'completed');
  const recent = [...records].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 5);
  const average = completed.length ? Math.round(completed.reduce((sum, record) => {
    const template = checklistTemplates.find((item) => item.id === record.templateId);
    return sum + getStats(template, record).score;
  }, 0) / completed.length) : null;
  const gaps = completed.reduce((sum, record) => {
    const template = checklistTemplates.find((item) => item.id === record.templateId);
    return sum + getStats(template, record).critical.length + getStats(template, record).major.length;
  }, 0);

  return <div className="page page-dashboard">
    <section className="dashboard-hero">
      <div className="hero-copy"><div className="eyebrow">REGULATORY WORKSPACE · {formatDate(new Date(), { month: 'long', day: 'numeric', year: 'numeric' })}</div><h1>Make every room<br /><em>count.</em></h1><p>One clear view of facility readiness, from first walkthrough to final sign-off.</p><div className="hero-actions"><button className="button primary" onClick={() => onStart()}><Plus size={17} /> Start an inspection</button><button className="button ghost" onClick={onLibrary}><BookOpen size={16} /> Browse checklists</button></div></div>
      <div className="hero-drawing" aria-hidden="true"><div className="sun-disc" /><div className="arch arch-one" /><div className="arch arch-two" /><div className="hero-line hero-line-one" /><div className="hero-line hero-line-two" /><div className="hero-stamp"><ClipboardCheck size={22} /><span>ready<br />to review</span></div></div>
    </section>

    <section className="stats-row">
      <StatCard icon={<PencilLine size={17} />} label="Active drafts" value={drafts.length} note={drafts.length ? 'pick up where you left off' : 'nothing waiting in the wings'} tone="aqua" />
      <StatCard icon={<BadgeCheck size={17} />} label="Completed visits" value={completed.length} note={average === null ? 'your first report is one visit away' : `${average}% average compliance`} tone="gold" />
      <StatCard icon={<BookOpen size={17} />} label="Templates ready" value={checklistTemplates.length} note="built from supplied source checklists" tone="plum" />
      <StatCard icon={<BarChart3 size={17} />} label="Open gaps" value={gaps} note="across completed inspections" tone="coral" />
    </section>

    <section className="content-grid dashboard-grid">
      <div className="panel recent-panel">
        <div className="panel-heading"><div><div className="eyebrow">YOUR FIELD LOG</div><h2>Recent inspections</h2></div><button className="icon-button" aria-label="More options"><MoreHorizontal size={18} /></button></div>
        {recent.length === 0 ? <EmptyRecent onStart={onStart} /> : <div className="record-list">{recent.map((record) => {
          const template = checklistTemplates.find((item) => item.id === record.templateId);
          const stats = getStats(template, record);
          return <div className="record-row" key={record.id} onClick={() => onOpen(record.id)}>
            <IconMark template={template} />
            <div className="record-main"><div className="record-name">{record.metadata.facilityName || 'Untitled facility'}</div><div className="record-sub"><span>{template.title}</span><span className="dot-separator">·</span><span>Edited {formatShortDate(record.updatedAt)}</span></div></div>
            <div className="record-right"><ScoreChip score={stats.score} /><StatusPill status={record.status} /><button className="delete-button" onClick={(event) => { event.stopPropagation(); onRemove(record.id); }} aria-label="Remove inspection"><Trash2 size={15} /></button></div>
          </div>;
        })}</div>}
      </div>
      <div className="panel signal-panel">
        <div className="panel-heading"><div><div className="eyebrow">INSPECTION RHYTHM</div><h2>Stay in the room</h2></div><div className="mini-orbit"><span /></div></div>
        <div className="signal-graphic"><div className="signal-circle circle-one" /><div className="signal-circle circle-two" /><div className="signal-center"><HeartPulse size={23} /><strong>{drafts.length ? drafts.length : '—'}</strong><span>visits in motion</span></div></div>
        <p className="signal-copy">A good audit is part checklist, part conversation. Keep your notes close and your next action visible.</p>
        <button className="text-button" onClick={() => onStart()}>Open a fresh visit <ArrowRight size={15} /></button>
      </div>
    </section>
  </div>;
}

function StatCard({ icon, label, value, note, tone }) {
  return <div className={`stat-card ${tone}`}><div className="stat-icon">{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-note">{note}</div></div>;
}

function EmptyRecent({ onStart }) {
  return <div className="empty-state"><div className="empty-icon"><FileText size={23} /></div><h3>Your field log is clear.</h3><p>Start your first visit and your inspections will gather here, ready for the next handoff.</p><button className="button secondary" onClick={() => onStart()}><Plus size={15} /> Start first inspection</button></div>;
}

function MissingRecord({ onHome }) {
  return <div className="page"><div className="panel missing-record"><div className="empty-icon"><Search size={22} /></div><div className="eyebrow">LOCAL RECORD NOT FOUND</div><h2>This inspection is no longer in this browser.</h2><p>It may have been removed or you may be opening it on a different device. Return to the overview to start a new local visit.</p><button className="button primary" onClick={onHome}><Home size={16} /> Back to overview</button></div></div>;
}

function Library({ search, setSearch, onStart }) {
  const filtered = checklistTemplates.filter((template) => `${template.title} ${template.description}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="page page-library">
    <PageHeader eyebrow="SOURCE CHECKLISTS" title="The library" description="Seven inspection paths, translated into one focused workspace." action={<button className="button primary" onClick={() => onStart()}><Plus size={17} /> New inspection</button>} />
    <div className="library-toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search facility type or checklist…" /></div><div className="filter-note"><Filter size={15} /> Showing {filtered.length} of {checklistTemplates.length}</div></div>
    <div className="library-intro"><div className="intro-mark"><Archive size={20} /></div><div><strong>Built from your supplied documents.</strong><span>Each template keeps its source wording, optional requirements, response scale, and severity cues.</span></div></div>
    <div className="template-grid">{filtered.map((template, index) => <TemplateCard key={template.id} template={template} index={index} onStart={onStart} />)}</div>
  </div>;
}

function TemplateCard({ template, index, onStart }) {
  const standardCount = template.sections.reduce((sum, section) => sum + section.items.filter((item) => item.responseType === 'standard').length, 0);
  const availabilityCount = template.itemCount - standardCount;
  return <article className={`template-card ${templateAccent(index)}`}>
    <div className="template-card-top"><IconMark template={template} size="large" /><span className="template-code">0{index + 1} / {String(template.itemCount).padStart(3, '0')} items</span></div>
    <h2>{template.title}</h2><p>{template.description}</p>
    <div className="template-card-meta"><span><FileCheck2 size={14} /> {template.sections.length} sections</span><span><ClipboardCheck size={14} /> {standardCount} standards</span>{availabilityCount > 0 && <span><Archive size={14} /> {availabilityCount} supplies</span>}</div>
    <button className="card-link" onClick={() => onStart(template.id)}>Use this checklist <ArrowRight size={15} /></button>
  </article>;
}

function NewInspection({ record, template, selectedTemplateId, setSelectedTemplateId, onUpdate, onStart, onCancel }) {
  const metadata = record.metadata || DEFAULT_META;
  const setField = (field, value) => onUpdate(record.id, { metadata: { ...metadata, [field]: value } });
  return <div className="page page-new">
    <PageHeader eyebrow="OPEN A FIELD VISIT" title="Set the context first." description="A few details now make the final report much easier to trust." action={<button className="button ghost" onClick={onCancel}><X size={16} /> Cancel</button>} />
    <div className="setup-layout">
      <section className="panel setup-form-panel">
        <div className="setup-panel-header"><div><div className="eyebrow">01 · SELECT CHECKLIST</div><h2>What are you assessing?</h2></div><span className="required-note">* required for report</span></div>
        <div className="setup-template-list">{checklistTemplates.map((item, index) => <button key={item.id} className={`setup-template ${item.id === record.templateId ? 'selected' : ''}`} onClick={() => onUpdate(record.id, { templateId: item.id, currentSection: 0 })}><IconMark template={item} /><span><strong>{item.title}</strong><small>{item.itemCount} items · {item.sections.length} sections</small></span>{item.id === record.templateId && <CheckCircle2 size={17} className="selected-check" />}</button>)}</div>
      </section>
      <section className="panel setup-form-panel">
        <div className="setup-panel-header"><div><div className="eyebrow">02 · FACILITY SNAPSHOT</div><h2>Who is in the room?</h2></div><Info size={18} className="muted-icon" /></div>
        <div className="form-grid">
          <Field label="Facility name" required value={metadata.facilityName} onChange={(value) => setField('facilityName', value)} placeholder="e.g. Selam Primary Clinic" wide />
          <Field label="Facility address" value={metadata.facilityAddress} onChange={(value) => setField('facilityAddress', value)} placeholder="Region · city · woreda" wide />
          <Field label="Head / director" value={metadata.headName} onChange={(value) => setField('headName', value)} placeholder="Full name" />
          <Field label="Owner / operator" value={metadata.ownerName} onChange={(value) => setField('ownerName', value)} placeholder="Full name" />
          <Field label="Facility license no." value={metadata.licenseNo} onChange={(value) => setField('licenseNo', value)} placeholder="Optional" />
          <Field label="Year opened" value={metadata.yearOpened} onChange={(value) => setField('yearOpened', value)} placeholder="YYYY" />
          <Field label="Contact" value={metadata.contact} onChange={(value) => setField('contact', value)} placeholder="Phone / email" />
          <Field label="Annual patient load" value={metadata.annualLoad} onChange={(value) => setField('annualLoad', value)} placeholder="Optional" />
          <SelectField label="Inspection type" value={metadata.inspectionType} onChange={(value) => setField('inspectionType', value)} options={['Initial / New', 'Routine', 'Follow-up', 'Investigative']} />
          <SelectField label="Ownership" value={metadata.ownership} onChange={(value) => setField('ownership', value)} options={['Private', 'Governmental', 'Non-governmental']} />
          <Field label="Lead assessor" value={metadata.assessor} onChange={(value) => setField('assessor', value)} placeholder="Your name" wide />
          <Field label="Visit note" value={metadata.notes} onChange={(value) => setField('notes', value)} placeholder="A short context note for the report" wide textarea />
        </div>
        <div className="setup-submit"><div><strong>{template.title}</strong><span>Ready for {template.itemCount} source requirements</span></div><button className="button primary" disabled={!metadata.facilityName.trim()} onClick={() => onStart(record.id, 'audit')}>Open audit workspace <ArrowRight size={16} /></button></div>
      </section>
    </div>
  </div>;
}

function Field({ label, required, value, onChange, placeholder, wide, textarea }) {
  return <label className={`field ${wide ? 'wide' : ''}`}><span>{label}{required && <b> *</b>}</span>{textarea ? <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} rows="3" /> : <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />}</label>;
}

function SelectField({ label, value, onChange, options }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select></label>;
}

function AuditWorkspace({ record, template, onUpdate, onSummary, onExit }) {
  const stats = getStats(template, record);
  const currentIndex = Math.min(record.currentSection || 0, template.sections.length - 1);
  const section = template.sections[currentIndex];
  const sectionStat = stats.sectionStats[currentIndex];
  const totalProgress = Math.round((stats.completed / stats.total) * 100) || 0;
  const setSection = (index) => onUpdate(record.id, { currentSection: index });
  const setResponse = (item, status) => {
    const current = record.responses[item.id] || {};
    onUpdate(record.id, { responses: { ...record.responses, [item.id]: { ...current, status } } });
  };
  const setRemark = (item, remark) => {
    const current = record.responses[item.id] || {};
    onUpdate(record.id, { responses: { ...record.responses, [item.id]: { ...current, remark } } });
  };
  return <div className="page audit-page">
    <div className="audit-header"><div><button className="back-link" onClick={onExit}><ArrowLeft size={15} /> All inspections</button><div className="audit-title-row"><IconMark template={template} /><div><div className="eyebrow">{record.metadata.facilityName || 'Untitled facility'} · {record.metadata.inspectionType}</div><h1>{template.title}</h1></div></div></div><div className="audit-header-actions"><div className="progress-summary"><span>{stats.completed} / {stats.total} answered</span><strong>{totalProgress}%</strong><div className="progress-track"><span style={{ width: `${totalProgress}%` }} /></div></div><button className="button secondary" onClick={onSummary}><BarChart3 size={16} /> View summary</button></div></div>
    <div className="audit-layout">
      <aside className="section-nav panel"><div className="eyebrow">VISIT SECTIONS</div><h3>Walk the standard</h3><div className="section-list">{template.sections.map((item, index) => { const s = stats.sectionStats[index]; return <button className={`section-nav-item ${index === currentIndex ? 'active' : ''}`} key={item.id} onClick={() => setSection(index)}><span className="section-number">{String(index + 1).padStart(2, '0')}</span><span className="section-nav-copy"><strong>{item.title}</strong><small>{s.answered}/{s.total} answered</small></span>{s.unanswered === 0 ? <CheckCircle2 size={15} className="section-done" /> : <span className="section-mini-progress"><i style={{ width: `${(s.answered / s.total) * 100}%` }} /></span>}</button>; })}</div><div className="audit-help"><ShieldCheck size={17} /><p><strong>Scoring note</strong><br />Optional items are excluded unless you mark them applicable.</p></div></aside>
      <section className="audit-content"><div className="section-heading"><div><div className="eyebrow">SECTION {String(currentIndex + 1).padStart(2, '0')} / {String(template.sections.length).padStart(2, '0')}</div><h2>{section.title}</h2><p>{sectionStat.answered} answered · {sectionStat.unanswered} required remaining · <strong>{sectionStat.score}% section score</strong></p></div><div className={`section-score ${scoreTone(sectionStat.score)}`}><span>score</span><strong>{sectionStat.score}%</strong></div></div><div className="items-list">{section.items.map((item, itemIndex) => <AuditItem key={item.id} item={item} number={itemIndex + 1} response={record.responses[item.id]} onStatus={setResponse} onRemark={setRemark} />)}</div><div className="audit-footer"><button className="button ghost" disabled={currentIndex === 0} onClick={() => setSection(currentIndex - 1)}><ArrowLeft size={16} /> Previous</button>{currentIndex < template.sections.length - 1 ? <button className="button primary" onClick={() => setSection(currentIndex + 1)}>Next section <ArrowRight size={16} /></button> : <button className="button primary" onClick={onSummary}>Review inspection <BarChart3 size={16} /></button>}</div></section>
    </div>
  </div>;
}

function AuditItem({ item, number, response, onStatus, onRemark }) {
  const options = item.responseType === 'availability' ? [['available', 'Available'], ['not-available', 'Not available']] : [['met', 'Met'], ['partial', 'Partially met'], ['unmet', 'Unmet']];
  return <article className={`audit-item ${response?.status === 'unmet' || response?.status === 'not-available' ? 'has-gap' : ''}`}><div className="item-number">{String(number).padStart(2, '0')}</div><div className="item-body"><div className="item-topline"><div className="item-labels">{item.severity && <span className={`severity ${item.severity}`}>{item.severity}</span>}{item.optional && <span className="optional-label">Optional</span>}</div><span className="item-type">{item.responseType === 'availability' ? 'Supply / equipment' : 'Standard'}</span></div><h3>{item.text}</h3><div className="response-row">{options.map(([status, label]) => <button key={status} className={`response-button ${status} ${response?.status === status ? 'selected' : ''}`} onClick={() => onStatus(item, status)}>{response?.status === status && <Check size={14} />}{label}</button>)}{item.optional && <button className={`response-button na ${response?.status === 'na' ? 'selected' : ''}`} onClick={() => onStatus(item, 'na')}>{response?.status === 'na' && <Check size={14} />}Not applicable</button>}</div><div className="remark-row"><PencilLine size={14} /><input value={response?.remark || ''} onChange={(event) => onRemark(item, event.target.value)} placeholder="Add a remark, evidence note, or follow-up…" /></div></div></article>;
}

function Summary({ record, template, onUpdate, onAudit, onReport }) {
  const stats = getStats(template, record);
  const canFinalize = stats.unanswered.length === 0;
  const finalize = () => {
    if (!canFinalize) return;
    onUpdate(record.id, { status: 'completed', completedAt: new Date().toISOString() });
    onReport();
  };
  const returnToGap = () => {
    const first = stats.unanswered[0] || stats.gaps[0];
    const index = Math.max(0, template.sections.findIndex((section) => section.items.some((item) => item.id === first?.id)));
    onUpdate(record.id, { currentSection: index });
    onAudit();
  };
  return <div className="page page-summary"><PageHeader eyebrow="REVIEW BEFORE SIGN-OFF" title="The readout." description="A quick, honest view of what is ready, what needs attention, and what is still unanswered." action={<button className="button ghost" onClick={onAudit}><ArrowLeft size={16} /> Back to audit</button>} />
    <div className="summary-top"><div className={`score-hero ${scoreTone(stats.score)}`}><div className="score-ring" style={{ '--score': `${stats.score * 3.6}deg` }}><div><strong>{stats.score}</strong><span>/ 100</span></div></div><div><div className="eyebrow">OVERALL COMPLIANCE</div><h2>{stats.score >= 85 ? 'Strong footing.' : stats.score >= 70 ? 'A few things to tune.' : 'Action is needed.'}</h2><p>{stats.completed} of {stats.total} requirements answered across {template.sections.length} sections.</p></div></div><div className="summary-actions panel"><div className="eyebrow">NEXT STEP</div><h3>{canFinalize ? 'Ready to issue the report.' : `${stats.unanswered.length} required ${stats.unanswered.length === 1 ? 'item remains' : 'items remain'}.`}</h3><p>{canFinalize ? 'Finalize this inspection to lock the visit and open the print-ready report.' : 'Complete every required item before sign-off. Optional items can stay open.'}</p><button className="button primary full" disabled={!canFinalize} onClick={finalize}>{canFinalize ? <><FileCheck2 size={16} /> Finalize & open report</> : <><Clock3 size={16} /> Finish required items first</>}</button>{!canFinalize && <button className="text-button centered" onClick={returnToGap}>Jump to first open item <ArrowRight size={15} /></button>}</div></div>
    <div className="summary-columns"><div className="panel section-summary-panel"><div className="panel-heading"><div><div className="eyebrow">SECTION READOUT</div><h2>Where things stand</h2></div><span className="summary-count">{stats.sectionStats.filter((item) => item.unanswered === 0).length}/{stats.sectionStats.length} ready</span></div><div className="summary-section-list">{stats.sectionStats.map((section, index) => <button className="summary-section-row" key={section.id} onClick={() => { onUpdate(record.id, { currentSection: index }); onAudit(); }}><div className={`summary-section-index ${section.unanswered === 0 ? 'done' : ''}`}>{section.unanswered === 0 ? <Check size={15} /> : String(index + 1).padStart(2, '0')}</div><div className="summary-section-name"><strong>{section.title}</strong><span>{section.answered}/{section.total} answered · {section.unanswered ? `${section.unanswered} open` : 'complete'}</span></div><ScoreChip score={section.score} /><ChevronRight size={16} /></button>)}</div></div><div className="panel gap-panel"><div className="panel-heading"><div><div className="eyebrow">ATTENTION MARKERS</div><h2>Gaps to carry forward</h2></div><span className="gap-count">{stats.gaps.length}</span></div>{stats.gaps.length === 0 ? <div className="all-clear"><CheckCircle2 size={26} /><strong>No open gaps.</strong><span>Every assessed requirement is currently met.</span></div> : <div className="gap-list">{stats.gaps.slice(0, 8).map((item) => <div className="gap-row" key={item.id}><div className={`gap-icon ${item.severity || 'unmet'}`}>{item.severity === 'critical' ? '!' : item.severity === 'major' ? '◆' : '·'}</div><div><strong>{item.text}</strong><span>{item.severity ? `${item.severity} · ` : ''}{responseLabel(record.responses[item.id]?.status, item.responseType)}</span></div></div>)}{stats.gaps.length > 8 && <span className="more-gaps">+ {stats.gaps.length - 8} more in report</span>}</div>}</div></div>
  </div>;
}

function Report({ record, template, onAudit, onSummary }) {
  const stats = getStats(template, record);
  return <div className="page page-report"><div className="report-toolbar"><button className="back-link" onClick={onSummary}><ArrowLeft size={15} /> Back to summary</button><div className="report-actions"><button className="button ghost" onClick={onAudit}><PencilLine size={16} /> Edit inspection</button><button className="button primary" onClick={() => window.print()}><Printer size={16} /> Print / save PDF</button></div></div><div className="report-sheet"><div className="report-masthead"><div className="report-brand"><div className="brand-symbol"><HeartPulse size={18} /></div><div><div className="brand-name">Care<span>Audit</span></div><div className="brand-caption">facility compliance</div></div></div><div className="report-status"><BadgeCheck size={15} /> FINAL INSPECTION REPORT</div></div><div className="report-heading"><div><div className="eyebrow">{template.title}</div><h1>{record.metadata.facilityName || 'Untitled facility'}</h1><p>{record.metadata.facilityAddress || 'Address not supplied'} · {record.metadata.inspectionType} visit · completed {formatDate(record.completedAt || record.updatedAt)}</p></div><div className={`report-score ${scoreTone(stats.score)}`}><strong>{stats.score}%</strong><span>overall compliance</span></div></div><div className="report-meta-grid"><ReportMeta label="Facility head" value={record.metadata.headName} /><ReportMeta label="Owner / operator" value={record.metadata.ownerName} /><ReportMeta label="License number" value={record.metadata.licenseNo} /><ReportMeta label="Lead assessor" value={record.metadata.assessor} /><ReportMeta label="Contact" value={record.metadata.contact} /><ReportMeta label="Annual patient load" value={record.metadata.annualLoad} /></div><div className="report-callout"><div className="callout-icon"><ShieldCheck size={18} /></div><div><strong>{stats.score >= 85 ? 'Strong footing with targeted follow-up.' : stats.score >= 70 ? 'Compliant in many areas, with follow-up required.' : 'Material gaps require a documented action plan.'}</strong><span>{stats.critical.length} critical markers · {stats.major.length} major markers · {stats.unanswered.length} unanswered requirements</span></div></div><div className="report-section"><div className="report-section-title"><span>01</span><h2>Section scores</h2></div><div className="report-section-table">{stats.sectionStats.map((section) => <div className="report-table-row" key={section.id}><div><strong>{section.title}</strong><span>{section.answered}/{section.total} answered</span></div><div className="report-bar"><span style={{ width: `${section.score}%` }} /></div><ScoreChip score={section.score} /></div>)}</div></div><div className="report-section report-break"><div className="report-section-title"><span>02</span><h2>Attention markers</h2></div>{stats.gaps.length === 0 ? <p className="report-empty">No gaps recorded in this inspection.</p> : <div className="report-gap-table">{stats.gaps.map((item) => <div className="report-gap-row" key={item.id}><span className={`severity ${item.severity || 'unmarked'}`}>{item.severity || 'open'}</span><div><strong>{item.text}</strong><span>{item.sectionTitle} · {responseLabel(record.responses[item.id]?.status, item.responseType)}{record.responses[item.id]?.remark ? ` · ${record.responses[item.id].remark}` : ''}</span></div></div>)}</div>}</div><div className="report-section report-break"><div className="report-section-title"><span>03</span><h2>Assessment detail</h2></div>{template.sections.map((section) => <div className="report-detail-section" key={section.id}><h3>{section.title}</h3>{section.items.map((item) => <div className="detail-row" key={item.id}><span className={`detail-status ${record.responses[item.id]?.status || 'pending'}`} /> <span className="detail-text"><span>{item.text}</span>{record.responses[item.id]?.remark && <small className="detail-remark">Remark: {record.responses[item.id].remark}</small>}</span><span className="detail-response">{responseLabel(record.responses[item.id]?.status, item.responseType)}</span></div>)}</div>)}</div><div className="report-section report-break"><div className="report-section-title"><span>04</span><h2>Visit notes</h2></div><p className="report-notes">{record.metadata.notes || 'No additional visit note was recorded.'}</p><div className="signature-grid"><div><span>Process owner</span><strong>{record.metadata.processOwner || '____________________________'}</strong></div><div><span>Lead assessor</span><strong>{record.metadata.assessor || '____________________________'}</strong></div><div><span>Date</span><strong>{formatDate(record.completedAt || record.updatedAt)}</strong></div></div></div><div className="report-footer"><span>CareAudit · Source checklist: {template.sourceFile}</span><span>Generated {formatDate(new Date())}</span></div></div></div>;
}

function ReportMeta({ label, value }) { return <div className="report-meta"><span>{label}</span><strong>{value || '—'}</strong></div>; }

createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
