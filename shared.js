/* ============================================================
   IHS OT Documentation App — Shared JS Utilities
   session.js + ai.js + note-builder.js (combined for simplicity)
   ============================================================ */

// ── Session Storage ──────────────────────────────────────────
const Session = {
  key(module) { return `ot_${module}_draft`; },

  save(module, data) {
    try {
      sessionStorage.setItem(this.key(module), JSON.stringify({
        data,
        savedAt: new Date().toISOString()
      }));
    } catch(e) { console.warn('Session save failed', e); }
  },

  load(module) {
    try {
      const raw = sessionStorage.getItem(this.key(module));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.data;
    } catch(e) { return null; }
  },

  clear(module) {
    sessionStorage.removeItem(this.key(module));
  },

  // visit counter stored in sessionStorage (non-PHI)
  getVisitCount() {
    return parseInt(sessionStorage.getItem('ot_visit_count') || '0');
  },

  setVisitCount(n) {
    sessionStorage.setItem('ot_visit_count', String(n));
  },

  // clinician name (non-PHI, persists across sessions via sessionStorage)
  getClinicianName() {
    return sessionStorage.getItem('ot_clinician') || '';
  },

  setClinicianName(name) {
    sessionStorage.setItem('ot_clinician', name);
  }
};

// ── AI API calls ─────────────────────────────────────────────
const AI = {
  async call(messages, systemPrompt, options = {}) {
    const body = {
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: systemPrompt,
      messages
    };

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw new Error(`API error ${res.status}`);
    const data = await res.json();
    return data.content?.[0]?.text || '';
  },

  // Build a note from form data
  async generateNote(noteData, module) {
    const systemPrompt = NOTE_SYSTEM_PROMPTS[module] || NOTE_SYSTEM_PROMPTS.eval;

    const userMsg = `Generate a complete SOAP note from the following structured data. 
Follow all formatting rules exactly: use S: / O: / A: / P: / BILLING: as section headers, 
dashes for unordered lists, numbers for goals, no symbols except dashes and periods, 
minimize abbreviations, no OT jargon in final output.

Note data:
${JSON.stringify(noteData, null, 2)}`;

    return this.call(
      [{ role: 'user', content: userMsg }],
      systemPrompt
    );
  },

  // Refine note via chatbot
  async refineNote(currentNote, userRequest, history = []) {
    const systemPrompt = NOTE_SYSTEM_PROMPTS.refine;
    const messages = [
      ...history,
      {
        role: 'user',
        content: `Current note:\n\n${currentNote}\n\n---\nRequest: ${userRequest}`
      }
    ];
    return this.call(messages, systemPrompt);
  },

  // Extract pull-forward data from pasted eval note
  async extractFromNote(pastedNote) {
    const systemPrompt = `You are a clinical data extractor. Extract structured data from 
the occupational therapy SOAP note provided. Return ONLY valid JSON with this structure:
{
  "injuryDate": "YYYY-MM-DD or null",
  "surgeryDate": "YYYY-MM-DD or null",
  "precautions": ["list of precautions"],
  "surgeonProtocol": "text or null",
  "priorInterventions": ["list of interventions"],
  "goals": [{"text": "goal text", "type": "STG|LTG", "targetDate": "YYYY-MM-DD or null", "status": "In Progress"}],
  "frequency": "text or null",
  "authorizedVisits": "number or null",
  "diagnosis": "text or null"
}
Return only the JSON object, no markdown, no explanation.`;

    const text = await this.call(
      [{ role: 'user', content: pastedNote }],
      systemPrompt
    );

    try {
      return JSON.parse(text.trim());
    } catch(e) {
      console.warn('Parse failed, returning raw', text);
      return null;
    }
  }
};

// ── System Prompts ────────────────────────────────────────────
const NOTE_SYSTEM_PROMPTS = {
  eval: `You are an expert occupational therapy documentation specialist. 
Generate Medicare-compliant outpatient OT SOAP notes for the Indian Health Service EHR.

FORMATTING RULES (non-negotiable):
- Section headers: S: / O: / A: / P: / BILLING:
- Unordered lists: dashes (-) only, never bullets or asterisks
- Ordered lists: numbers (1. 2. 3.) for goals only
- No symbols except dashes, periods, parentheses, and numbers
- Abbreviations: spell out on first use; minimize throughout
- No OT-specific jargon in final output (translate to plain clinical language)
- Concise: evaluation note target under 600 words

CLINICAL REQUIREMENTS:
- Assessment must demonstrate skilled OT need (diagnosis alone is not sufficient)
- Assessment must include functional limitation statement linking impairment to occupational performance
- Goals must follow: Condition + Behavior + Criterion + Timeline format
- Goals ordered by target date (soonest first), numbered
- Plan must include frequency, duration, and planned CPT codes
- Billing section: list OT evaluation complexity code first, then timed codes

MEDICARE COMPLIANCE:
- Document skilled care rationale explicitly
- Assessment should include differential diagnosis and prognosis
- All goals must be measurable and time-bound with target assessment dates`,

  followup: `You are an expert occupational therapy documentation specialist.
Generate Medicare-compliant outpatient OT follow-up SOAP notes for the Indian Health Service EHR.

FORMATTING RULES (non-negotiable):
- Section headers: S: / O: / A: / P: / BILLING:
- Unordered lists: dashes (-) only
- Ordered lists: numbers (1. 2. 3.) for goals
- No symbols except dashes, periods, parentheses
- Abbreviations minimized; spelled out on first use
- No OT jargon — plain clinical language
- Follow-up target under 350 words

CLINICAL REQUIREMENTS:
- Include status-post notation (e.g., "Patient is 6 weeks and 3 days post-right distal radius ORIF")
- Assessment must show progress toward each goal with status
- Shorter than evaluation assessment — synthesize, do not repeat raw data
- If visit number is a multiple of 10: include formal goal-by-goal progress summary per Medicare requirements

MEDICARE COMPLIANCE:
- Skilled care rationale must be evident
- Document measurable progress (or lack thereof) with objective data
- Note any plan modifications and rationale`,

  discharge: `You are an expert occupational therapy documentation specialist.
Generate Medicare-compliant occupational therapy discharge SOAP notes for the Indian Health Service EHR.

FORMATTING RULES (non-negotiable):
- Section headers: S: / O: / A: / P: / BILLING:
- Dashes for lists, numbers for goals
- No OT jargon, plain clinical language
- Target under 400 words

CLINICAL REQUIREMENTS:
- Include: dates of initial and final service, total sessions attended
- Summarize progress toward each goal: initial status vs final status
- Include patient's self-report of OT efficacy
- Include HEP status and discharge disposition
- Include recommendations for future needs

AOTA DOCUMENTATION COMPLIANCE:
- Per AOTA guidelines, discharge report must document summary of intervention process,
  progress toward goals, and client outcomes including initial and ending status`,

  refine: `You are an expert occupational therapy documentation specialist helping refine a SOAP note.
Apply the clinician's requested changes while maintaining all formatting rules:
- Section headers: S: / O: / A: / P: / BILLING:
- Dashes for lists, numbers for goals  
- No OT jargon, plain clinical language
- Medicare compliance maintained
Return the complete revised note only — no explanation, no preamble.`
};

// ── Note Builder Utilities ────────────────────────────────────
const NoteBuilder = {
  // Format date as "Month DD, YYYY"
  formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  },

  // Calculate status-post duration
  statusPost(dateStr) {
    if (!dateStr) return null;
    const then = new Date(dateStr + 'T00:00:00');
    const now  = new Date();
    const diff = now - then;
    if (diff < 0) return null;
    const days  = Math.floor(diff / (1000 * 60 * 60 * 24));
    const weeks = Math.floor(days / 7);
    const rem   = days % 7;
    if (weeks === 0) return `${days} day${days !== 1 ? 's' : ''}`;
    if (rem   === 0) return `${weeks} week${weeks !== 1 ? 's' : ''}`;
    return `${weeks} week${weeks !== 1 ? 's' : ''} and ${rem} day${rem !== 1 ? 's' : ''}`;
  },

  // Target date from eval date + weeks
  targetDate(evalDateStr, weeks) {
    if (!evalDateStr || !weeks) return '';
    const d = new Date(evalDateStr + 'T00:00:00');
    d.setDate(d.getDate() + (parseInt(weeks) * 7));
    return d.toISOString().split('T')[0];
  },

  // Render note preview with section highlighting
  renderPreview(noteText, container) {
    if (!container) return;
    const sections = ['S:', 'O:', 'A:', 'P:', 'BILLING:'];
    let html = noteText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    sections.forEach(s => {
      const label = s.replace(':', '');
      html = html.replace(
        new RegExp(`^${s}`, 'gm'),
        `<span class="note-section-head">${s}</span>`
      );
    });

    container.innerHTML = html;
  }
};

// ── UI Utilities ──────────────────────────────────────────────
const UI = {
  // Toggle check-item selection
  initCheckItems(container) {
    container.querySelectorAll('.check-item').forEach(item => {
      item.addEventListener('click', () => {
        const input = item.querySelector('input');
        if (!input) return;
        if (input.type === 'checkbox') {
          input.checked = !input.checked;
          item.classList.toggle('selected', input.checked);
        } else if (input.type === 'radio') {
          container.querySelectorAll('.check-item').forEach(i => i.classList.remove('selected'));
          input.checked = true;
          item.classList.add('selected');
        }
      });
    });
  },

  // Toggle accordion
  initAccordions(container) {
    container.querySelectorAll('.accordion-trigger').forEach(trigger => {
      trigger.addEventListener('click', () => {
        const body = trigger.nextElementSibling;
        const isOpen = trigger.classList.contains('open');
        trigger.classList.toggle('open', !isOpen);
        body.classList.toggle('open', !isOpen);
      });
    });
  },

  // Toggle CPT expansion panels
  initCPTRows(container) {
    container.querySelectorAll('.cpt-expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const row = btn.closest('.cpt-row');
        const panel = row.querySelector('.cpt-row__expansion');
        const isOpen = panel.classList.contains('open');
        panel.classList.toggle('open', !isOpen);
        btn.querySelector('svg').style.transform = isOpen ? '' : 'rotate(180deg)';
      });
    });
  },

  // NRS sliders
  initSliders(container) {
    container.querySelectorAll('input[type="range"]').forEach(slider => {
      const display = document.getElementById(slider.dataset.display);
      if (display) {
        display.textContent = slider.value;
        slider.addEventListener('input', () => { display.textContent = slider.value; });
      }
    });
  },

  // Toggles
  initToggles(container) {
    container.querySelectorAll('.toggle-wrap').forEach(wrap => {
      const toggle = wrap.querySelector('.toggle');
      const input  = wrap.querySelector('input[type="checkbox"]');
      if (!toggle || !input) return;
      toggle.classList.toggle('on', input.checked);
      wrap.addEventListener('click', () => {
        input.checked = !input.checked;
        toggle.classList.toggle('on', input.checked);
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
  },

  // Copy to clipboard
  async copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('btn--primary');
      setTimeout(() => {
        btn.textContent = orig;
        btn.classList.remove('btn--primary');
      }, 2000);
    } catch(e) {
      console.warn('Copy failed', e);
    }
  },

  // Show loading state on button
  setLoading(btn, loading) {
    if (loading) {
      btn.dataset.origText = btn.innerHTML;
      btn.innerHTML = '<div class="spinner"></div>';
      btn.disabled = true;
    } else {
      btn.innerHTML = btn.dataset.origText || btn.innerHTML;
      btn.disabled = false;
    }
  },

  // Toast notification
  toast(message, type = 'info', duration = 3000) {
    const t = document.createElement('div');
    t.className = `banner banner--${type}`;
    t.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;max-width:360px;animation:fadeIn 0.2s ease';
    t.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), duration);
  },

  // Progress step management
  setStep(stepIndex) {
    document.querySelectorAll('.step').forEach((step, i) => {
      step.classList.remove('step--active', 'step--complete');
      if (i < stepIndex) step.classList.add('step--complete');
      else if (i === stepIndex) step.classList.add('step--active');
    });
  }
};

// ── CPT Code Data ─────────────────────────────────────────────
const CPT_CODES = {
  // Evaluation
  '97165': { title: 'OT Evaluation — Low Complexity',    unit: 'per encounter', contact: true,  category: 'eval' },
  '97166': { title: 'OT Evaluation — Moderate Complexity', unit: 'per encounter', contact: true, category: 'eval' },
  '97167': { title: 'OT Evaluation — High Complexity',   unit: 'per encounter', contact: true,  category: 'eval' },
  '97168': { title: 'OT Re-Evaluation',                  unit: 'per encounter', contact: true,  category: 'eval' },
  // Modalities supervised
  '97010': { title: 'Hot or Cold Packs',                 unit: 'per session',  contact: false, category: 'modality' },
  '97018': { title: 'Paraffin Bath',                     unit: 'per session',  contact: false, category: 'modality' },
  '97022': { title: 'Whirlpool',                         unit: 'per session',  contact: false, category: 'modality' },
  'G0281': { title: 'Electrical Stimulation — Wound Care', unit: 'per session', contact: false, category: 'modality', wound: true },
  'G0283': { title: 'Electrical Stimulation — Unattended (non-wound)', unit: 'per session', contact: false, category: 'modality' },
  // Modalities constant attendance
  '97035': { title: 'Ultrasound',                        unit: 'per 15 min',   contact: true,  category: 'modality' },
  // Therapeutic procedures
  '97110': { title: 'Therapeutic Exercise',              unit: 'per 15 min',   contact: true,  category: 'tx' },
  '97112': { title: 'Neuromuscular Reeducation',         unit: 'per 15 min',   contact: true,  category: 'tx' },
  '97124': { title: 'Massage',                           unit: 'per 15 min',   contact: true,  category: 'tx' },
  '97129': { title: 'Cognitive Function Intervention (initial)', unit: 'per 15 min', contact: true, category: 'tx' },
  '97130': { title: 'Cognitive Function Intervention (add-on)', unit: 'per 15 min', contact: true, category: 'tx', addon: true },
  '97140': { title: 'Manual Therapy',                    unit: 'per 15 min',   contact: true,  category: 'tx' },
  '97150': { title: 'Therapeutic Exercise — Group',      unit: 'per session (untimed)', contact: false, category: 'tx' },
  '97530': { title: 'Therapeutic Activities',            unit: 'per 15 min',   contact: true,  category: 'tx' },
  '97533': { title: 'Sensory Integrative Techniques',    unit: 'per 15 min',   contact: true,  category: 'tx' },
  '97535': { title: 'Self-Care / Home Management Training', unit: 'per 15 min', contact: true, category: 'tx' },
  '97537': { title: 'Community / Work Reintegration Training', unit: 'per 15 min', contact: true, category: 'tx' },
  '97542': { title: 'Wheelchair Management',             unit: 'per 15 min',   contact: true,  category: 'tx' },
  '97550': { title: 'Caregiver Training (initial 30 min)', unit: 'per 30 min', contact: true,  category: 'tx' },
  '97551': { title: 'Caregiver Training (add-on 15 min)', unit: 'per 15 min',  contact: true,  category: 'tx', addon: true },
  // Wound care
  '97597': { title: 'Selective Debridement, first 20 sq cm', unit: 'per session', contact: true, category: 'wound', wound: true },
  '97598': { title: 'Selective Debridement, add\'l 20 sq cm', unit: 'per session', contact: true, category: 'wound', wound: true, addon: true },
  '97602': { title: 'Non-Selective Debridement',         unit: 'per session',  contact: true,  category: 'wound', wound: true },
  '97610': { title: 'Low Frequency Non-Contact Ultrasound (MIST)', unit: 'per day', contact: true, category: 'wound', wound: true },
  // Tests
  '97750': { title: 'Physical Performance Test / Measurement', unit: 'per 15 min', contact: true, category: 'test' },
  '97755': { title: 'Assistive Technology Assessment',   unit: 'per 15 min',   contact: true,  category: 'test' },
  // Orthotic
  '97760': { title: 'Orthotic Management — Initial',     unit: 'per 15 min',   contact: true,  category: 'ortho' },
  '97761': { title: 'Prosthetic Training — Initial',     unit: 'per 15 min',   contact: true,  category: 'ortho' },
  '97763': { title: 'Orthotic/Prosthetic Management — Subsequent', unit: 'per 15 min', contact: true, category: 'ortho' }
};

// Build CPT row HTML
function buildCPTRow(code, includeTimeInputs = true) {
  const info = CPT_CODES[code];
  if (!info) return '';

  const woundBadge = info.wound
    ? `<span class="section-badge" style="background:rgba(192,73,90,0.15);color:#D46070;border-color:rgba(192,73,90,0.3)">LCD Required</span>`
    : '';

  const addonBadge = info.addon
    ? `<span class="section-badge" style="font-size:0.65rem">Add-on</span>`
    : '';

  const timeInputs = includeTimeInputs ? `
    <div class="grid-2 mt-12" style="max-width:360px">
      <div class="form-group mb-0">
        <label class="form-label">Minutes</label>
        <input type="number" class="form-input" min="0" max="240" placeholder="0"
               data-code="${code}" data-field="minutes">
      </div>
      <div class="form-group mb-0">
        <label class="form-label">Units</label>
        <input type="number" class="form-input" min="0" max="16" placeholder="0"
               data-code="${code}" data-field="units">
      </div>
    </div>` : '';

  return `
<div class="cpt-row" data-code="${code}">
  <div class="cpt-row__header" style="cursor:default">
    <span class="cpt-code">${code}</span>
    <div>
      <span class="cpt-title">${info.title}</span>
      ${woundBadge} ${addonBadge}
    </div>
    <span class="cpt-unit">${info.unit}</span>
    <button class="cpt-expand-btn" onclick="toggleCPTExpansion('${code}', this)" title="View code definition">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style="transition:transform 0.2s">
        <path d="M2 4.5L7 9.5L12 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
    </button>
  </div>
  ${timeInputs}
  <div class="cpt-row__expansion" id="cpt-exp-${code}">
    ${buildCPTExpansion(code)}
  </div>
</div>`;
}

function toggleCPTExpansion(code, btn) {
  const panel = document.getElementById(`cpt-exp-${code}`);
  const isOpen = panel.classList.contains('open');
  panel.classList.toggle('open', !isOpen);
  btn.querySelector('svg').style.transform = isOpen ? '' : 'rotate(180deg)';
}

// CPT expansion content — pulled from the full reference document
function buildCPTExpansion(code) {
  const data = CPT_EXPANSION_DATA[code];
  if (!data) return '<p class="text-muted" style="font-size:0.85rem">Definition data loading…</p>';

  return `
    <div class="cpt-expansion__section">
      <div class="cpt-expansion__label">Official Definition (2026)</div>
      <div class="cpt-expansion__body">${data.definition}</div>
    </div>
    <div class="grid-2 mt-12" style="gap:12px;margin-bottom:14px">
      <div>
        <div class="cpt-expansion__label">Time Unit</div>
        <code>${data.unit}</code>
      </div>
      <div>
        <div class="cpt-expansion__label">Direct Contact</div>
        <code>${data.contact ? 'Required' : 'Not required (supervised)'}</code>
      </div>
    </div>
    <div class="cpt-expansion__section">
      <div class="cpt-expansion__label">Clinical Examples — Outpatient Upper Quarter OT</div>
      <div class="cpt-expansion__body">
        <ul>${data.examples.map(e => `<li>${e}</li>`).join('')}</ul>
      </div>
    </div>
    <div class="cpt-expansion__section">
      <div class="cpt-expansion__label">Documentation Must Include</div>
      <div class="cpt-expansion__body">
        <ul>${data.docReqs.map(r => `<li>${r}</li>`).join('')}</ul>
      </div>
    </div>
    <div class="cpt-audit-flag">
      <strong>Audit Flags:</strong>
      <ul>${data.auditFlags.map(f => `<li>${f}</li>`).join('')}</ul>
    </div>`;
}

// ── CPT Expansion Data ────────────────────────────────────────
const CPT_EXPANSION_DATA = {
  '97165': {
    definition: 'Occupational therapy evaluation, low complexity. Requires: an occupational profile and brief medical/therapy history; assessment identifying 1-3 performance deficits resulting in activity limitations; and clinical decision making of low complexity considering a limited number of treatment options. Patient presents with no comorbidities affecting clinical decision making.',
    unit: 'Per encounter', contact: true,
    examples: [
      'New patient with uncomplicated distal radius fracture (non-operative), limited wrist ROM, no comorbidities',
      'Patient with simple trigger finger (post-injection) referred for splinting and home exercise program',
      'Patient with mild lateral epicondylitis, first episode, no neurological involvement',
    ],
    docReqs: [
      'Occupational profile documenting roles, routines, and participation restrictions',
      '1-3 specific performance deficits identified by objective assessment',
      'Clinical reasoning linking deficits to a focused treatment plan',
      'Diagnosis alone is not sufficient — state how deficits limit occupational performance',
    ],
    auditFlags: [
      'Do not use if comorbidities (diabetes, neuropathy, CRPS) influenced clinical decision making — that elevates to moderate or high',
      'Do not use if more than 3 performance deficits are identified',
    ]
  },
  '97166': {
    definition: 'Occupational therapy evaluation, moderate complexity. Requires: expanded review of medical/therapy records; assessment identifying 3-5 performance deficits; and clinical decision making of moderate complexity considering several treatment options. Patient may present with comorbidities that affect occupational performance.',
    unit: 'Per encounter', contact: true,
    examples: [
      'Patient with carpal tunnel syndrome with documented median neuropathy (EMG reviewed), grip weakness, sensory loss, and functional limitations',
      'Post-operative rotator cuff repair with protocol review, multiple ROM and strength deficits, and occupational performance limitations',
      'Patient with rheumatoid arthritis affecting multiple hand joints requiring joint protection, adaptive equipment, and splinting analysis',
    ],
    docReqs: [
      'Expanded occupational profile demonstrating broader context of functional impact',
      '3-5 distinct performance deficits with objective measurements',
      'Evidence that comorbidities were considered in clinical reasoning',
      'Plan reflects consideration of multiple treatment approaches',
    ],
    auditFlags: [
      'Must document why moderate complexity reasoning was required — number and type of deficits must be evident in the Objective',
      'Billing moderate for every patient regardless of presentation is an audit red flag',
    ]
  },
  '97167': {
    definition: 'Occupational therapy evaluation, high complexity. Requires: extensive review of medical/therapy records and psychosocial history; assessment identifying 5 or more performance deficits; and clinical decision making of high complexity considering multiple treatment options. Patient presents with 3 or more comorbidities affecting occupational performance.',
    unit: 'Per encounter', contact: true,
    examples: [
      'Brachial plexus injury with multiple nerve distributions affected, combined ROM/strength/sensory deficits, and vocational impact',
      'Post-CVA with upper extremity involvement, complex spasticity, cognitive deficits, and restrictions across all ADL domains',
      'Severe crush injury requiring assessment of wound, tendon, neurovascular, sensory, edema, and full occupational profile',
    ],
    docReqs: [
      'Extensive occupational profile with review of prior reports and psychosocial history',
      '5 or more performance deficits, each supported by objective assessment data',
      'Documented consideration of 3 or more comorbidities in clinical decision making',
      'Comprehensive plan addressing all deficit areas',
    ],
    auditFlags: [
      'Must be genuinely supported by 5+ documented performance deficits and 3+ comorbidities — highest audit risk of the three eval codes',
      'All comorbidities must be named and their relevance to clinical reasoning stated',
    ]
  },
  '97168': {
    definition: 'Occupational therapy re-evaluation. Performed when new clinical findings emerge, a significant change in patient condition is observed, the patient demonstrates lack of expected response per the plan of care, or additional information is required for discharge planning.',
    unit: 'Per encounter', contact: true,
    examples: [
      'Patient developing unexpected adhesion formation during flexor tendon protocol — requires revised plan of care',
      'Patient with worsening neurological symptoms despite conservative treatment — reassessment to update diagnosis and goals',
      'Patient achieving goals ahead of schedule — re-evaluation to establish new goals and extend plan of care',
    ],
    docReqs: [
      'Indication for re-evaluation must be explicitly stated (one of the four criteria above)',
      'New objective findings that differ from the original evaluation',
      'Revised or updated goals based on re-evaluation findings',
      'Updated plan of care',
    ],
    auditFlags: [
      'Cannot be billed simply as a routine progress check — documented clinical indication is required',
      'Do not use at every 30-day interval without a specific indication; use progress note format instead',
    ]
  },
  '97010': {
    definition: 'Application of a modality to one or more areas; hot or cold packs.',
    unit: 'Per session', contact: false,
    examples: [
      'Hot pack to forearm and wrist prior to therapeutic exercise to improve tissue extensibility',
      'Cold pack to wrist and hand following exercise to manage post-activity swelling and pain',
      'Moist heat to shoulder girdle prior to manual therapy or stretching',
    ],
    docReqs: [
      'Body region treated',
      'Purpose (e.g., pain modulation prior to exercise, edema management post-exercise)',
      'Duration (typically 10-15 minutes)',
      'Patient response',
    ],
    auditFlags: [
      'Often not reimbursed as a standalone code — typically billed alongside a therapeutic procedure',
      'Should not be the primary or only service billed; must be clinically justified',
    ]
  },
  '97018': {
    definition: 'Application of a modality to one or more areas; paraffin bath.',
    unit: 'Per session', contact: false,
    examples: [
      'Paraffin bath to hand and wrist for patient with scleroderma or rheumatoid arthritis to improve tissue pliability before ROM exercise',
      'Paraffin application to arthritic hand joints for pain modulation and preparation for fine motor tasks',
      'Post-cast removal — paraffin to forearm and wrist to address skin dryness and improve soft tissue mobility',
    ],
    docReqs: [
      'Body region and purpose',
      'Contraindications checked and ruled out (open wounds, decreased sensation, vascular insufficiency)',
      'Patient response and tolerance',
    ],
    auditFlags: [
      'Contraindicated with open wounds or decreased sensation — document that contraindications were ruled out',
      'Not reimbursable as a standalone service without associated therapeutic goals',
    ]
  },
  '97022': {
    definition: 'Application of a modality to one or more areas; whirlpool.',
    unit: 'Per session', contact: false,
    examples: [
      'Upper extremity whirlpool for wound debridement or wound bed preparation in post-surgical open wound',
      'Whirlpool for softening of scar tissue after hand surgery',
      'Hydrotherapy for severe edema and joint stiffness following crush injury',
    ],
    docReqs: [
      'Body region, water temperature, and duration',
      'Purpose (wound care, edema, scar, ROM preparation)',
      'Wound dimensions if used for wound care (LCD L35125 requirements apply)',
      'Patient response',
    ],
    auditFlags: [
      'When used for wound care, LCD L35125 documentation requirements apply in addition to CPT requirements',
      'Per LCD: wet therapy should be used cautiously as maceration of surrounding tissue may hinder healing',
    ]
  },
  'G0281': {
    definition: 'Electrical stimulation for wound care, applied to a wound or wounds, as part of a therapy plan of care.',
    unit: 'Per session', contact: false,
    examples: [
      'Electrical stimulation to a chronic venous stasis ulcer with no measurable improvement after 30 days of standard wound care',
      'E-stim to post-surgical wound with impaired healing in patient with immunosuppression or poor perfusion',
    ],
    docReqs: [
      'Wound location, dimensions, and tissue characteristics (per LCD L35125)',
      'Evidence that conventional wound care was attempted or that e-stim is appropriate per plan of care',
      'Patient response and wound status changes at each visit',
    ],
    auditFlags: [
      'This code is specifically for wound care applications only — do not use for non-wound indications (use G0283)',
      'Per NCD 270.1, electrical stimulation for wounds has specific coverage criteria — review NCD before billing',
    ]
  },
  'G0283': {
    definition: 'Electrical stimulation (unattended), to one or more areas for indication(s) other than wound care, as part of a therapy plan of care.',
    unit: 'Per session', contact: false,
    examples: [
      'TENS applied to forearm for pain modulation in lateral epicondylitis during supervised treatment',
      'NMES to wrist extensors to address drop wrist following radial nerve injury',
      'Interferential current to shoulder for acute pain management in adhesive capsulitis',
    ],
    docReqs: [
      'Body region and indication (non-wound)',
      'Parameters if clinically relevant (frequency, intensity, waveform)',
      'Purpose and monitoring performed during application',
      'Patient response',
    ],
    auditFlags: [
      'Do not use for wound-related electrical stimulation — use G0281',
      'Patient must be monitored periodically even though direct one-on-one contact is not required continuously',
    ]
  },
  '97035': {
    definition: 'Application of a modality to one or more areas; ultrasound, each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Therapeutic ultrasound to common flexor tendon origin for chronic medial epicondylitis',
      'Phonophoresis with anti-inflammatory medication to lateral epicondyle for resistant lateral epicondylitis',
      'Ultrasound to adherent scar overlying dorsal wrist to improve tissue extensibility before stretching',
    ],
    docReqs: [
      'Body region, frequency (MHz), intensity (W/cm²), mode (pulsed or continuous), duration',
      'Clinical rationale for ultrasound selection',
      'Patient response (thermal sensation, tissue changes, pain reduction)',
    ],
    auditFlags: [
      'Contraindicated over growth plates (pediatric), areas of malignancy, pacemakers, or areas of decreased sensation — document ruling out',
      'Must document each 15-minute increment separately if billing more than one unit',
    ]
  },
  '97110': {
    definition: 'Therapeutic procedure, one or more areas, each 15 minutes; therapeutic exercises to develop strength and endurance, range of motion, and flexibility.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Shoulder scaption, rows, and external rotation strengthening for rotator cuff tendinopathy (3 sets x 10 reps, resistance band)',
      'Active-assisted ROM exercises for wrist flexion/extension following distal radius ORIF',
      'Grip strengthening with TheraPutty after prolonged immobilization',
      'Cervical stretching and strengthening for forward head posture with associated shoulder dysfunction',
    ],
    docReqs: [
      'Specific exercises performed (not just "strengthening exercises" — name each one)',
      'Body region',
      'Parameters: sets, repetitions, resistance (weight or band level), or hold duration',
      'Total timed minutes (minimum 8 minutes for 1 unit)',
      'Patient response and any modifications made',
    ],
    auditFlags: [
      'Vague documentation such as "shoulder exercises performed" is insufficient — specific exercises must be named',
      'Passive ROM provided entirely by the therapist without active patient participation may not qualify',
      'Do not accumulate time with 97530 to reach a unit — time must be counted within the same code',
    ]
  },
  '97112': {
    definition: 'Therapeutic procedure, one or more areas, each 15 minutes; neuromuscular reeducation of movement, balance, coordination, kinesthetic sense, posture, and/or proprioception for sitting and/or standing activities.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Proprioceptive training for wrist after ligamentous injury — joint position sense tasks, unstable surface perturbations',
      'Motor re-education for radial nerve palsy — facilitation of wrist/finger extension with biofeedback or mirror therapy',
      'Scapular stabilization training — serratus anterior activation during functional reaching',
    ],
    docReqs: [
      'Specific neuromuscular techniques used and body region',
      'Target deficit (impaired proprioception, movement pattern dysfunction, coordination deficit)',
      'Patient performance and response',
      'Timed minutes',
    ],
    auditFlags: [
      'Should not be used interchangeably with 97110 — must involve a neuromuscular component (coordination, proprioception, motor control)',
      'Must document the neuromuscular rationale clearly',
    ]
  },
  '97124': {
    definition: 'Therapeutic procedure, one or more areas, each 15 minutes; massage, including effleurage, petrissage, and/or tapotement (stroking, compression, percussion).',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Scar massage to post-surgical hand scar to reduce adhesion, improve pliability, and desensitize hypersensitive tissue',
      'Retrograde massage to hand and forearm for lymphedema management and edema reduction',
      'Effleurage and petrissage to cervical paraspinals and upper trapezius for cervicogenic shoulder pain',
    ],
    docReqs: [
      'Specific massage technique(s) used (effleurage, petrissage, retrograde, scar mobilization)',
      'Body region and therapeutic goal',
      'Duration and patient response',
    ],
    auditFlags: [
      'For myofascial release techniques, use 97140 (Manual Therapy) — not 97124',
      'Massage must be clinically purposeful — do not document as relaxation or comfort care',
    ]
  },
  '97129': {
    definition: 'Therapeutic interventions focusing on cognitive function (attention, memory, reasoning, executive function, problem solving) and compensatory strategies to manage activity performance. Direct one-on-one patient contact; initial 15 minutes.',
    unit: 'Per 15 min (initial)', contact: true,
    examples: [
      'Cognitive strategy training for patient with mild TBI affecting return to work — task initiation, sequencing, and error monitoring',
      'Attention and memory compensation strategies for patient with cognitive impairment affecting home management',
      'Executive function training post-CVA — problem-solving and planning for meal preparation',
    ],
    docReqs: [
      'Specific cognitive domains addressed',
      'Activities or tasks used as intervention medium',
      'Compensatory strategies taught or practiced',
      'Functional goal being targeted',
    ],
    auditFlags: [
      'Must be tied to a functional occupational performance goal — not used for standalone cognitive testing',
      'Must be distinguished from cognitive assessments (96112, 96125) which are separate codes',
    ]
  },
  '97130': {
    definition: 'Cognitive function intervention, each additional 15 minutes. List separately in addition to 97129.',
    unit: 'Per 15 min (add-on)', contact: true,
    examples: ['Use in conjunction with 97129 for sessions extending beyond initial 15 minutes'],
    docReqs: ['Must be billed with 97129', 'Document total time and continued cognitive intervention'],
    auditFlags: ['Cannot be billed without 97129 on the same claim']
  },
  '97140': {
    definition: 'Manual therapy techniques (e.g., mobilization/manipulation, manual lymphatic drainage, manual traction), one or more regions, each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Joint mobilization (Maitland Grade III-IV) to radiocarpal joint for wrist stiffness following distal radius fracture',
      'Soft tissue mobilization and myofascial release to forearm flexors for lateral or medial epicondylitis',
      'Manual lymphatic drainage for upper extremity lymphedema following axillary node dissection',
      'IASTM to scar tissue or tendon pathology',
    ],
    docReqs: [
      'Specific technique (joint mobilization grade, MLD, IASTM, myofascial release)',
      'Region treated (specific joints or tissue)',
      'Clinical rationale and patient response (ROM change, pain change, tissue quality)',
      'Timed minutes',
    ],
    auditFlags: [
      'Requires hands-on skilled technique — document why skilled manual therapy was necessary',
      'Do not use for standard massage — use 97124',
    ]
  },
  '97150': {
    definition: 'Therapeutic procedure(s), group (two or more patients). Report for each member of the group. Involves constant attendance by the therapist but does not require one-on-one patient contact.',
    unit: 'Per session (untimed)', contact: false,
    examples: [
      'Hand exercise group for patients with rheumatoid arthritis — joint protection, ROM, and strengthening under OT supervision',
      'Post-operative hand therapy group for patients in similar protocol stages',
    ],
    docReqs: [
      'Group composition (number of patients)',
      'Exercises or activities performed',
      'Each patient\'s individual response documented separately',
      'Skilled supervision rationale',
    ],
    auditFlags: [
      'Bill once per patient per session — not once per group',
      'Do not bill 97110 or 97530 concurrently for the same time period while billing 97150',
    ]
  },
  '97530': {
    definition: 'Therapeutic activities, direct one-on-one patient contact (use of dynamic activities to improve functional performance), each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Functional grasp training — simulated jar opening, container manipulation, and tool use to improve grip in context',
      'Bilateral hand activities simulating meal preparation to address coordination and endurance',
      'Overhead reaching tasks using pegboards or shelf stacking to simulate work demands',
      'Dressing tasks using adaptive equipment for patient with limited shoulder ROM',
    ],
    docReqs: [
      'Specific functional activity performed (not generic "functional activities")',
      'Functional goal being targeted',
      'Patient performance and assistance required',
      'How the activity improves functional performance',
      'Timed minutes',
    ],
    auditFlags: [
      'Must be functionally based — not the same as exercise repetitions (use 97110 for those)',
      'Key distinction: 97110 = structured exercise; 97530 = purposeful functional activity',
      'Vague documentation ("functional activities performed") is a top audit risk for this code',
    ]
  },
  '97533': {
    definition: 'Sensory integrative techniques to enhance sensory processing and promote adaptive responses to environmental demands, direct one-on-one patient contact, each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Sensory desensitization program for hypersensitivity following digital nerve repair — graded texture exposure from cotton to rough fabrics',
      'Tactile discrimination training for median nerve injury to improve two-point discrimination',
      'Sensory re-education following partial nerve regeneration — localization, texture discrimination, object identification',
    ],
    docReqs: [
      'Sensory processing deficit being addressed',
      'Specific techniques and materials used (graded textures, vibration, moving touch, localization)',
      'Patient response and performance (threshold improvements, tolerance)',
      'Functional goal linked to sensory improvement',
    ],
    auditFlags: [
      'Must document a sensory processing deficit warranting skilled intervention',
      'Most appropriate when sensory deficits directly limit occupational performance',
    ]
  },
  '97535': {
    definition: 'Self-care/home management training (e.g., ADLs and compensatory training, meal preparation, safety procedures, and instructions in use of assistive technology devices/adaptive equipment), direct one-on-one contact, each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Training patient with dominant arm fracture in one-handed dressing techniques using button hook and elastic shoelaces',
      'HEP instruction and return demonstration following carpal tunnel release',
      'Instruction in adaptive equipment use for patient with arthritis limiting grip',
      'Splint wearing schedule education and donning/doffing training',
    ],
    docReqs: [
      'Specific skill or task trained',
      'Adaptive strategy or equipment addressed',
      'Patient\'s performance and level of independence achieved',
      'Instructions provided (verbal, written, or demonstrated)',
      'Timed minutes',
    ],
    auditFlags: [
      'Must involve skilled instruction — not simply observing the patient perform a task',
      'HEP education alone is borderline — document the skilled nature of instruction (technique correction, grading, safety)',
    ]
  },
  '97537': {
    definition: 'Community/work reintegration training (e.g., work environment/modification analysis, work task analysis, use of assistive technology/adaptive equipment), direct one-on-one contact, each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Work task simulation for patient returning to job requiring repetitive pinch and grip — task demand analysis and modification recommendations',
      'Community mobility training for patient with upper extremity limitations affecting driving or transportation',
      'Ergonomic assessment and recommendations for patient with chronic upper extremity pain',
    ],
    docReqs: [
      'Specific work or community task analyzed or trained',
      'Functional deficits addressed',
      'Modifications, adaptive strategies, or equipment recommended',
      'Patient performance and readiness assessment',
    ],
    auditFlags: [
      'Must be oriented toward return to community or work — not interchangeable with general therapeutic activities (97530)',
    ]
  },
  '97542': {
    definition: 'Wheelchair management (e.g., assessment, fitting, training), each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Wheelchair propulsion training for patient with bilateral upper extremity weakness — technique to protect shoulder joints',
      'Seating and positioning assessment for patient with upper extremity and trunk involvement',
      'Power wheelchair joystick adaptation training for patient with limited hand function',
    ],
    docReqs: [
      'Type of wheelchair (manual, power)',
      'Specific task trained or assessment performed',
      'Functional deficits addressed',
      'Patient performance and safety',
    ],
    auditFlags: ['Document specific wheelchair type and functional tasks trained']
  },
  '97550': {
    definition: 'Caregiver training in strategies and techniques to facilitate the patient\'s functional performance in the home or community (without the patient present), face-to-face; initial 30 minutes.',
    unit: 'Per 30 min (initial)', contact: true,
    examples: [
      'Training family member in assisting with post-operative upper extremity dressing and wound care at home',
      'Caregiver education on complex splint schedule and skin inspection',
      'Training parent in home exercise techniques for pediatric patient with congenital hand condition',
    ],
    docReqs: [
      'Caregiver\'s name and relationship to patient',
      'Specific strategies and techniques trained',
      'Caregiver\'s performance and understanding',
      'Note that patient was NOT present during the session',
    ],
    auditFlags: [
      'Patient must not be present — if patient attends, use 97535 instead',
      'Caregiver must be identified in the documentation',
    ]
  },
  '97551': {
    definition: 'Caregiver training, each additional 15 minutes. List separately in addition to 97550.',
    unit: 'Per 15 min (add-on)', contact: true,
    examples: ['Use in conjunction with 97550 for extended caregiver training sessions'],
    docReqs: ['Must be billed with 97550', 'Document total time and continued training content'],
    auditFlags: ['Cannot be billed without 97550']
  },
  '97597': {
    definition: 'Debridement (e.g., high pressure water jet, sharp selective debridement with scissors, scalpel, and forceps), open wound, including topical application(s), wound assessment, use of a whirlpool when performed and instruction(s) for ongoing care, per session; total wound surface area: first 20 sq cm or less.',
    unit: 'Per session', contact: true,
    examples: [
      'Sharp debridement of fibrinous exudate and devitalized tissue from post-surgical open wound on dorsal hand',
      'High-pressure water jet debridement of traumatic wound with embedded debris following crush injury',
    ],
    docReqs: [
      'Wound location and dimensions: length x width x depth in cm (REQUIRED per LCD L35125)',
      'Tissue type present: necrotic, eschar, fibrin, slough, granulation — percentage estimates helpful',
      'Debridement method used (scissors, scalpel, forceps, water jet)',
      'Description of tissue removed',
      'Wound appearance before and after debridement',
      'Signs of infection: present or absent',
      'Drainage: character and volume',
      'Evidence of wound improvement or documentation of status if no improvement',
      'Patient instruction provided for ongoing wound care',
    ],
    auditFlags: [
      'Wound dimensions are required at every wound care visit — do not omit',
      'Must document that necrotic, devitalized, or non-viable tissue was present and removed',
      'If wound shows no improvement after 30 days: document reassessment of underlying factors per LCD requirements',
    ]
  },
  '97598': {
    definition: 'Selective debridement, each additional 20 sq cm or part thereof. List separately in addition to 97597.',
    unit: 'Per additional 20 sq cm', contact: true,
    examples: ['45 sq cm wound = 97597 x1 + 97598 x2'],
    docReqs: [
      'Record total wound surface area',
      'Calculate units: first 20 sq cm = 97597; each additional 20 sq cm = 97598',
      'All LCD L35125 documentation requirements apply (same as 97597)',
    ],
    auditFlags: ['Cannot be billed without 97597', 'Must calculate surface area accurately and document calculation']
  },
  '97602': {
    definition: 'Removal of devitalized tissue from wound(s), non-selective debridement, without anesthesia (e.g., wet-to-moist dressings, enzymatic, abrasion, larval therapy), including topical application(s), wound assessment, and instruction(s) for ongoing care, per session.',
    unit: 'Per session', contact: true,
    examples: [
      'Application and removal of enzymatic debridement agent (e.g., collagenase) to wound with protein-based necrotic material',
      'Autolytic debridement using hydrocolloid or hydrogel dressing on wound without infection where manageable necrotic tissue is present',
    ],
    docReqs: [
      'Wound dimensions (required per LCD L35125)',
      'Type of non-selective debridement used and rationale',
      'Wound tissue characteristics before and after',
      'Dressing applied',
      'Patient instruction for ongoing care',
      'Evidence of improvement (required for continuing coverage)',
    ],
    auditFlags: [
      'Routine dressing changes are NOT a skilled service — debridement must address devitalized tissue and be documented as such',
      'Autolytic debridement is contraindicated for infected wounds — document absence of infection',
      'Per LCD: wet-to-dry dressings should be used cautiously as maceration may hinder healing',
    ]
  },
  '97610': {
    definition: 'Low frequency, non-contact, non-thermal ultrasound (MIST Therapy), including topical application(s) when performed, wound assessment, and instruction(s) for ongoing care, per day.',
    unit: 'Per day', contact: true,
    examples: [
      'MIST therapy to chronic non-healing venous ulcer that failed to improve after 30 days of standard wound care',
      'MIST therapy to wound too painful for sharp debridement with documented contraindications to excisional debridement',
    ],
    docReqs: [
      'Wound dimensions at every visit (required)',
      'Clinical indication for MIST: too painful for sharp debridement, contraindication to sharp debridement, OR no improvement after 30 days of standard care',
      'Observable improvement documented after 6 treatments (pain reduction, wound size reduction, improved granulation)',
    ],
    auditFlags: [
      'LCD frequency limit: 2-3 sessions per week; no more than 18 sessions in a 6-week period',
      'If no improvement after 6 treatments, continuing coverage is not reasonable and necessary per LCD',
      'Must document the specific qualifying indication — cannot be used as first-line wound care',
    ]
  },
  '97750': {
    definition: 'Physical performance test or measurement (e.g., musculoskeletal, functional capacity), with written report, each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Grip and pinch strength testing with calibrated dynamometer — written report with normative comparisons',
      'Nine-Hole Peg Test or Purdue Pegboard with timed scores and normative comparison',
      'UEFI, PRWE, or QDASH administration with scoring and written interpretation',
      'Semmes-Weinstein monofilament testing with written interpretation',
    ],
    docReqs: [
      'Specific test(s) administered',
      'Results with normative comparisons where applicable',
      'Written report (must be identifiable as such in the note)',
      'Clinical interpretation of results and relevance to functional goals',
    ],
    auditFlags: [
      'Requires a written report — documenting numbers alone without interpretation does not satisfy this requirement',
      'Can be billed separately from evaluation if testing occurs on a separate day',
    ]
  },
  '97755': {
    definition: 'Assistive technology assessment (e.g., to restore, augment, or compensate for existing function, optimize functional tasks, and/or maximize environmental accessibility), direct one-on-one contact, with written report, each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Assessment and recommendation for adaptive equipment for patient with severe hand arthritis — written report detailing deficits and recommended devices',
      'Evaluation for voice-to-text or switch access technology for patient with upper extremity limitation affecting computer use',
    ],
    docReqs: [
      'Functional deficits requiring assistive technology',
      'Assessment process and devices or systems evaluated',
      'Recommendations with clinical rationale',
      'Written report (formal, identifiable as such)',
    ],
    auditFlags: ['Requires a written report — assessment findings must be formally documented and interpretable as a report']
  },
  '97760': {
    definition: 'Orthotic(s) management and training (including assessment and fitting when not otherwise reported), upper extremity(ies), lower extremity(ies) and/or trunk, initial orthotic(s) encounter, each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Initial assessment, fabrication, fit, and training for custom wrist cock-up splint for carpal tunnel syndrome',
      'Fitting and wearing schedule training for prefabricated thumb spica splint for de Quervain\'s tenosynovitis',
      'Custom dynamic extension splint fabrication and initial training following extensor tendon repair',
    ],
    docReqs: [
      'Medical necessity for orthosis: diagnosis, functional limitations, prognosis (per Noridian ULO checklist)',
      'Clinical course (improving, stable, worsening)',
      'Prior interventions tried',
      'Whether prefabricated, custom-fitted, or custom-fabricated',
      'If custom-fitted: description of specific modifications made at fitting',
      'If custom-fabricated: documentation that prefabricated options were inadequate',
      'Wearing schedule provided to patient',
      'Fit check and patient response',
    ],
    auditFlags: [
      'Use only for initial orthotic encounters — use 97763 for all subsequent orthotic management visits',
      'Custom fabrication requires documented justification that prefabricated option was insufficient',
      'Custom fitting requires documentation of specific modifications made',
    ]
  },
  '97761': {
    definition: 'Prosthetic(s) training, upper and/or lower extremity(ies), initial prosthetic(s) encounter, each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Initial upper extremity prosthetic donning/doffing training following transradial amputation',
      'Body-powered prosthesis harness adjustment and cable control training',
      'Myoelectric prosthesis initial programming and functional use training',
    ],
    docReqs: [
      'Type of prosthesis',
      'Training goals and tasks addressed',
      'Patient performance and response',
    ],
    auditFlags: ['Use only for initial prosthetic encounters — use 97763 for subsequent visits']
  },
  '97763': {
    definition: 'Orthotic(s)/prosthetic(s) management and/or training, upper extremity(ies), lower extremity(ies), and/or trunk, subsequent orthotic(s)/prosthetic(s) encounter, each 15 minutes.',
    unit: 'Per 15 min', contact: true,
    examples: [
      'Follow-up check of custom wrist splint — pressure areas assessed, wearing schedule reviewed, fit adjusted',
      'Progression of dynamic splint tension or outrigger adjustment following tendon repair',
      'Skin integrity check and wearing schedule modification for patient with decreased sensation',
    ],
    docReqs: [
      'Orthosis type and body region',
      'Reason for follow-up (scheduled check, patient concern, protocol progression)',
      'Modifications made and rationale',
      'Patient response, skin status, and compliance with wearing schedule',
      'Timed minutes',
    ],
    auditFlags: [
      'Do not use 97760 for follow-up visits — 97763 is the correct subsequent encounter code',
      'If a new orthosis is fabricated at a follow-up (different device, different indication), 97760 may apply again — document accordingly',
    ]
  }
};
