// ==UserScript==
// @name         Coruson Report Status Scanner
// @namespace    haesl.qa.report-status-scanner
// @version      1.0.1
// @description  Scans Ideagen Coruson CAR and IOR reports and displays workflow status.
// @author       Bryce Lee
//
// @match        https://haesl.gaelenlighten.com/Reporting/ReportingManagement*
// @match        https://haesl.gaelenlighten.com/Reporting/Report/Index/*
//
// @updateURL    https://raw.githubusercontent.com/JwoToLee/Coruson-Report-Status-Scanner/main/Report-Status-Scanner.user.js
// @downloadURL  https://raw.githubusercontent.com/JwoToLee/Coruson-Report-Status-Scanner/main/Report-Status-Scanner.user.js
//
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    const CFG = {
        listPath: '/Reporting/ReportingManagement',
        detailPath: '/Reporting/Report/Index/',
        frameTimeoutMs: 45000,
        ajaxSettleMs: 4500,
        betweenCarsMs: 1200,
        scanDebounceMs: 800,
        selectors: {
            stage: 'li.stage-li',
            labels: 'div.details-label, .g-label, label',
            resultLink: 'a[href*="/Reporting/Report/Index/"]'
        }
    };

    const state = {
        running: false,
        stopRequested: false,
        minimized: false,
        links: [],
        rows: new Map(),
        frames: new Set(),
        route: location.href
    };

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();
    const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));

    function addStyles() {
        if (document.getElementById('haesl-car-status-style')) return;
        const style = document.createElement('style');
        style.id = 'haesl-car-status-style';
        style.textContent = `
            #haesl-car-ribbon{position:fixed;left:0;top:58px;bottom:0;width:600px;background:#0d1b2a;color:#e8eef5;z-index:2147483000;box-shadow:3px 0 18px rgba(0,0,0,.35);font:12px "Segoe UI",Arial,sans-serif;display:flex;flex-direction:column;transition:transform .2s ease}
            #haesl-car-ribbon.minimized{display:none}
            #haesl-car-ribbon *{box-sizing:border-box}
            .hcr-head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:#16324f;border-bottom:1px solid #315472}
            .hcr-title{font-weight:700;flex:1;color:#fff}.hcr-btn{border:1px solid #557895;background:#234b6c;color:#fff;border-radius:4px;padding:5px 8px;cursor:pointer}.hcr-btn:hover{background:#2d5d84}.hcr-btn:disabled{opacity:.45;cursor:not-allowed}
            .hcr-summary{padding:9px 12px;background:#10263b;border-bottom:1px solid #294760}.hcr-status{margin-top:5px;color:#b9cfdf}.hcr-status.error{color:#ff9d9d}.hcr-status.success{color:#83df9e}
            .hcr-table-wrap{overflow:auto;flex:1}.hcr-table{width:100%;border-collapse:collapse;table-layout:fixed}.hcr-table th{position:sticky;top:0;background:#1d3b56;color:#fff;text-align:left;padding:7px 6px;border-bottom:1px solid #45657d;font-size:11px}.hcr-table td{padding:7px 6px;border-bottom:1px solid #263f54;vertical-align:top;word-break:break-word}.hcr-table th:last-child{padding-right:28px}.hcr-table td:last-child{padding-right:28px}.hcr-table th:last-child,.hcr-table td:last-child{box-sizing:border-box}.hcr-table td:last-child .hcr-stage-map{margin-right:10px}.hcr-table tr:hover td{background:#132d43}.hcr-car a{color:#7dc7ff;text-decoration:none;font-weight:700}.hcr-mor-tag{display:inline-flex;margin-top:4px;padding:2px 5px;border-radius:3px;background:#f59e0b;color:#17202a;font-size:9px;font-weight:900;letter-spacing:.4px;border:1px solid #ffd27a}.hcr-stage{font-weight:600}.hcr-overdue{color:#ff8585;font-weight:700}.hcr-error{color:#ff9d9d}.hcr-loading{color:#ffd478}.hcr-stage-map{width:120px;min-width:120px;max-width:120px;display:grid;gap:4px}.hcr-stage-map.car{grid-template-columns:repeat(3,1fr);grid-template-rows:22px 28px}.hcr-stage-map.ior{grid-template-columns:repeat(4,1fr);grid-auto-rows:24px}.hcr-stage-box{display:flex;align-items:center;justify-content:center;border-radius:3px;border:1px solid rgba(255,255,255,.25);font-size:11px;font-weight:800;color:#fff;line-height:1}.hcr-stage-box.monitor{grid-column:1/4}.hcr-stage-map.ior .hcr-stage-box{font-size:9px}.hcr-stage-box.grey{background:#66727c}.hcr-stage-box.red{background:#d13438}.hcr-stage-box.green{background:#14873d}.hcr-footer{padding:8px 10px;border-top:1px solid #315472;background:#10263b;display:flex;gap:6px;flex-wrap:wrap}
            #haesl-car-tab{position:fixed;left:0;top:130px;z-index:2147483001;width:62px;height:38px;background:#16324f;color:#fff;border:1px solid #315472;border-left:0;border-radius:0 7px 7px 0;display:none;align-items:center;justify-content:center;cursor:pointer}
            .hcr-frame{position:fixed!important;left:-10000px!important;top:-10000px!important;width:1280px!important;height:900px!important;opacity:0!important;pointer-events:none!important;border:0!important}
        `;
        document.head.appendChild(style);
    }

    function createUI() {
        if (document.getElementById('haesl-car-ribbon')) return;
        const ribbon = document.createElement('section');
        ribbon.id = 'haesl-car-ribbon';
        ribbon.innerHTML = `
            <div class="hcr-head">
                <div class="hcr-title">Report Status Scanner</div>
                <button class="hcr-btn" id="hcr-refresh" type="button">Refresh</button>
                <button class="hcr-btn" id="hcr-min" type="button">◀</button>
            </div>
            <div class="hcr-summary">
                <div><strong id="hcr-count">0</strong> CAR / IOR links detected on the current register view</div>
                <div class="hcr-status" id="hcr-status">Ready</div>
            </div>
            <div class="hcr-table-wrap">
                <table class="hcr-table">
                    <thead><tr><th style="width:13%">Report</th><th style="width:17%">Stage</th><th style="width:17%">Owner</th><th style="width:15%">Target</th><th style="width:14%">Status</th><th style="width:24%">Progress Bar</th></tr></thead>
                    <tbody id="hcr-body"></tbody>
                </table>
            </div>
            <div class="hcr-footer">
                <button class="hcr-btn" id="hcr-start" type="button">Scan visible reports</button>
                <button class="hcr-btn" id="hcr-stop" type="button" disabled>Stop</button>
                <button class="hcr-btn" id="hcr-csv" type="button" disabled>Export CSV</button>
                <button class="hcr-btn" id="hcr-clear" type="button">Clear</button>
            </div>`;
        document.body.appendChild(ribbon);

        const tab = document.createElement('button');
        tab.id = 'haesl-car-tab';
        tab.type = 'button';
        tab.textContent = 'Report';
        tab.title = 'Show Report Status Scanner';
        document.body.appendChild(tab);

        document.getElementById('hcr-refresh').addEventListener('click', () => {
            if (state.running) return;
            // Refresh is discovery-only. Discard all extracted workflow/MOR data
            // so Progress Bar remains empty until the user starts a fresh scan.
            state.rows.clear();
            discoverLinks();
            renderDiscovered();
            document.getElementById('hcr-csv').disabled = true;
            setStatus(state.links.length
                ? `Refreshed ${state.links.length} report link(s). Select Scan visible reports to load status data.`
                : 'No CAR or IOR links found in the current register view.');
        });
        document.getElementById('hcr-min').addEventListener('click', minimize);
        tab.addEventListener('click', maximize);
        document.getElementById('hcr-start').addEventListener('click', runScan);
        document.getElementById('hcr-stop').addEventListener('click', stopScan);
        document.getElementById('hcr-csv').addEventListener('click', exportCSV);
        document.getElementById('hcr-clear').addEventListener('click', clearResults);
    }

    function setStatus(text, kind = '') {
        const el = document.getElementById('hcr-status');
        if (!el) return;
        el.className = `hcr-status ${kind}`.trim();
        el.textContent = text;
    }

    function minimize() {
        state.minimized = true;
        const ribbon = document.getElementById('haesl-car-ribbon');
        if (ribbon) ribbon.classList.add('minimized');
        const tab = document.getElementById('haesl-car-tab');
        if (tab) tab.style.display = 'flex';
    }

    function maximize() {
        state.minimized = false;
        const ribbon = document.getElementById('haesl-car-ribbon');
        if (ribbon) ribbon.classList.remove('minimized');
        const tab = document.getElementById('haesl-car-tab');
        if (tab) tab.style.display = 'none';
    }

    function discoverLinks() {
        const found = new Map();
        document.querySelectorAll(CFG.selectors.resultLink).forEach(a => {
            const href = a.href;
            if (!href) return;
            const text = normalize(a.textContent);
            const rowText = normalize(a.closest('tr')?.textContent);
            const match = `${text} ${rowText}`.match(/(?:CAR[-\s]?\d+|IOR\s*-?\s*\d{4}\s*-?\s*\d+)/i);
            const id = match ? match[0].replace(/\s+/g, '-').replace(/-+/g, '-').toUpperCase() : text || href.split('/').filter(Boolean).pop();
            if (id && !found.has(href)) found.set(href, { id, url: href });
        });
        state.links = [...found.values()];
        const count = document.getElementById('hcr-count');
        if (count) count.textContent = String(state.links.length);
        return state.links;
    }

    function renderDiscovered() {
        const body = document.getElementById('hcr-body');
        if (!body) return;
        body.innerHTML = '';
        for (const link of state.links) upsertRow(link.id, { carId: link.id, url: link.url, loading: false, scanned: false, status: 'Not scanned', stages: null, mor: false });
        setStatus(state.links.length ? `Found ${state.links.length} CAR / IOR link(s) in the current DOM.` : 'No CAR or IOR links found in the current register view.', state.links.length ? '' : 'error');
    }

    function cleanFieldValue(value) {
        return normalize(value)
            .replace(/\b(?:Cancel|Save|Edit|Update)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isCompletedStatus(statusText) {
        return /\b(?:complete|completed|closed)\b/i.test(normalize(statusText));
    }

    function classifyTarget(targetText, statusText) {
        if (isCompletedStatus(statusText)) return false;
        const m = cleanFieldValue(targetText).match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        if (!m) return false;
        const date = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), 23, 59, 59);
        return !Number.isNaN(date.getTime()) && date < new Date();
    }

    function stageColour(stage) {
        if (!stage || !stage.present) return 'grey';
        if (stage.completed) return 'green';
        if (classifyTarget(stage.targetDate, stage.status)) return 'red';
        return 'grey';
    }

    function stageTooltip(name, stage) {
        if (!stage || !stage.present) return `${name}: not started or unavailable`;
        const parts = [name, stage.status || 'No status'];
        if (stage.owner) parts.push(`Owner: ${stage.owner}`);
        if (stage.targetDate) parts.push(`Target: ${stage.targetDate}`);
        if (stage.completedDate) parts.push(`Completed: ${stage.completedDate}`);
        return parts.join(' | ');
    }

    function renderStageMap(stages, reportType) {
        if (reportType === 'IOR') {
            const items = [
                ['CR', 'Containment / QI Report', stages?.containment],
                ['N', 'Notification to HSI', stages?.notificationHsi],
                ['OI', 'Occurrence Investigation', stages?.occurrenceInvestigation],
                ['FU', 'QA Follow Up', stages?.qaFollowUp],
                ['HI', 'Hazard Investigation', stages?.hazardInvestigation],
                ['HR', 'HSI Response', stages?.hsiResponse],
                ['C', 'HQA Closure', stages?.hqaClosure]
            ];
            return `<div class="hcr-stage-map ior" aria-label="IOR workflow progress">${items.map(([code,name,stage]) =>
                `<div class="hcr-stage-box ${stageColour(stage)}" title="${esc(stageTooltip(name, stage))}">${code}</div>`
            ).join('')}</div>`;
        }
        const monitor = stages?.monitor;
        const investigation = stages?.investigation;
        const followUp = stages?.qaFollowUp;
        const closure = stages?.hqaClosure;
        return `
            <div class="hcr-stage-map car" aria-label="CAR workflow progress">
                <div class="hcr-stage-box monitor ${stageColour(monitor)}" title="${esc(stageTooltip('Monitor', monitor))}">Monitor</div>
                <div class="hcr-stage-box ${stageColour(investigation)}" title="${esc(stageTooltip('Investigation', investigation))}">I</div>
                <div class="hcr-stage-box ${stageColour(followUp)}" title="${esc(stageTooltip('QA Follow Up', followUp))}">FU</div>
                <div class="hcr-stage-box ${stageColour(closure)}" title="${esc(stageTooltip('HQA Closure', closure))}">C</div>
            </div>`;
    }

    function upsertRow(id, data) {
        state.rows.set(id, {...state.rows.get(id), ...data});
        const body = document.getElementById('hcr-body');
        if (!body) return;
        const rowId = `hcr-${id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        let tr = document.getElementById(rowId);
        if (!tr) {
            tr = document.createElement('tr');
            tr.id = rowId;
            body.appendChild(tr);
        }
        const d = state.rows.get(id);
        const overdue = classifyTarget(d.targetDate, d.error || d.status);
        tr.innerHTML = `
            <td class="hcr-car"><a href="${esc(d.url || '#')}" target="_blank" rel="noopener noreferrer">${esc(d.carId || id)}</a>${d.mor ? '<br><span class="hcr-mor-tag" title="Reportable Occurrence to Authorities is set to Yes">MOR</span>' : ''}</td>
            <td class="hcr-stage ${d.loading ? 'hcr-loading' : ''}">${esc(d.loading ? 'Loading…' : d.activeStage || d.stage || '')}</td>
            <td>${esc(d.owner || '')}</td>
            <td class="${overdue ? 'hcr-overdue' : ''}">${esc(d.targetDate || '')}${overdue ? ' • overdue' : ''}</td>
            <td class="${d.error ? 'hcr-error' : ''}">${esc(d.error || d.status || '')}</td>
            <td>${d.scanned && d.stages ? renderStageMap(d.stages, d.reportType) : ''}</td>`;
        document.getElementById('hcr-csv').disabled = ![...state.rows.values()].some(x => !x.loading && !x.error && x.owner);
    }

    function findLabelValue(scope, labels) {
        const labelNodes = [...scope.querySelectorAll(CFG.selectors.labels)];
        for (const node of labelNodes) {
            const labelText = normalize(node.textContent).replace(/:$/, '').toLowerCase();
            if (!labels.some(x => labelText === x.toLowerCase() || labelText.includes(x.toLowerCase()))) continue;
            const sibling = node.nextElementSibling;
            const candidate = sibling?.querySelector('.staticText,.staticTextContainer,.g-value') || sibling;
            let value = cleanFieldValue(candidate?.textContent);
            if (!value && node.parentElement) {
                const siblings = [...node.parentElement.children].filter(x => x !== node);
                value = cleanFieldValue(siblings.map(x => x.textContent).join(' '));
            }
            value = cleanFieldValue(value);
            if (value) return value;
        }
        return '';
    }

    function stageData(stage, name) {
        // Ideagen exposes the authoritative state in the stage-progress
        // element and in classes such as Completed, InProgress and NotStarted.
        const progressNode = stage.querySelector('.stage-progress');
        const progressClass = normalize(progressNode?.className);
        let status = cleanFieldValue(progressNode?.textContent);
        if (!status) status = cleanFieldValue(findLabelValue(stage, ['Status']));
        if (/\bcompleted?\b/i.test(progressClass) && !isCompletedStatus(status)) status = 'Completed';
        else if (/\binprogress\b/i.test(progressClass) && !status) status = 'In Progress';
        else if (/\bnotstarted\b/i.test(progressClass) && !status) status = 'Not Started';

        const completedDate = cleanFieldValue(findLabelValue(stage, ['Completed date', 'Completion date']));
        const targetDate = cleanFieldValue(findLabelValue(stage, ['Target Date']));
        const completed = /\bcompleted?\b/i.test(progressClass) || isCompletedStatus(status) || Boolean(completedDate);
        return {
            name,
            present: true,
            owner: cleanFieldValue(findLabelValue(stage, ['Stage Owner'])),
            targetDate,
            status: completed && !status ? 'Completed' : status,
            completedDate,
            completed
        };
    }

    function emptyStage(name) {
        return {name, present: false, owner: '', targetDate: '', status: 'Not started', completedDate: '', completed: false};
    }

    function detectStageName(stage) {
        const exact = /^(monitor(?:\s*\(for qa use\))?|investigation|qa\s*follow\s*up|hqa\s*closure|raise containment report or quality issue investigation report(?:\s*\(if necessary\))?|notification to hsi|occurrence investigation|hazard investigation|hsi response)$/i;
        const preferred = stage.querySelector('.stage-title-text,[data-inline-prev-val],.stage-title-lip-holder .staticTextContainer');
        const preferredText = normalize(preferred?.textContent);
        if (exact.test(preferredText)) return preferredText;
        const candidates = [...stage.querySelectorAll('.stage-title-text,[data-inline-prev-val],.staticTextContainer,h1,h2,h3,h4')]
            .map(node => normalize(node.textContent)).filter(text => text.length > 0 && text.length < 140);
        return candidates.find(text => exact.test(text)) || '';
    }

    function extractFromDocument(doc, fallbackId, url) {
        const pageText = normalize(doc.body?.textContent);
        const titleText = normalize(doc.querySelector('h1,.report-title,.g-page-title')?.textContent || doc.title || pageText.slice(0,300));
        const iorMatch = pageText.match(/IOR\s*-?\s*\d{4}\s*-?\s*\d+/i);
        const carMatch = pageText.match(/CAR[-\s]?\d+/i);
        const reportType = iorMatch || /Internal Occurrence Report/i.test(titleText) ? 'IOR' : 'CAR';
        const carId = (iorMatch || carMatch)?.[0]?.replace(/\s+/g, '-').replace(/-+/g, '-').toUpperCase() || fallbackId;
        const raisedDate = findLabelValue(doc, ['Raised Date', 'Submitted Date']);

        const stages = reportType === 'IOR' ? {
            containment: emptyStage('Containment / QI Report'),
            notificationHsi: emptyStage('Notification to HSI'),
            occurrenceInvestigation: emptyStage('Occurrence Investigation'),
            qaFollowUp: emptyStage('QA Follow Up'),
            hazardInvestigation: emptyStage('Hazard Investigation'),
            hsiResponse: emptyStage('HSI Response'),
            hqaClosure: emptyStage('HQA Closure')
        } : {
            monitor: emptyStage('Monitor'),
            investigation: emptyStage('Investigation'),
            qaFollowUp: emptyStage('QA Follow Up'),
            hqaClosure: emptyStage('HQA Closure')
        };

        for (const stage of [...doc.querySelectorAll(CFG.selectors.stage)]) {
            const name = detectStageName(stage);
            const key = name.toLowerCase();
            if (reportType === 'IOR') {
                if (/^raise containment report|^containment/.test(key)) stages.containment = stageData(stage, 'Containment / QI Report');
                else if (/^notification to hsi$/.test(key)) stages.notificationHsi = stageData(stage, 'Notification to HSI');
                else if (/^occurrence investigation$/.test(key)) stages.occurrenceInvestigation = stageData(stage, 'Occurrence Investigation');
                else if (/^qa\s*follow\s*up$/.test(key)) stages.qaFollowUp = stageData(stage, 'QA Follow Up');
                else if (/^hazard investigation$/.test(key)) stages.hazardInvestigation = stageData(stage, 'Hazard Investigation');
                else if (/^hsi response$/.test(key)) stages.hsiResponse = stageData(stage, 'HSI Response');
                else if (/^hqa\s*closure$/.test(key)) stages.hqaClosure = stageData(stage, 'HQA Closure');
            } else {
                if (/^monitor/.test(key)) stages.monitor = stageData(stage, 'Monitor');
                else if (/^investigation$/.test(key)) stages.investigation = stageData(stage, 'Investigation');
                else if (/^qa\s*follow\s*up$/.test(key)) stages.qaFollowUp = stageData(stage, 'QA Follow Up');
                else if (/^hqa\s*closure$/.test(key)) stages.hqaClosure = stageData(stage, 'HQA Closure');
            }
        }

        const workflowOrder = reportType === 'IOR'
            ? [stages.containment, stages.notificationHsi, stages.occurrenceInvestigation, stages.qaFollowUp, stages.hazardInvestigation, stages.hsiResponse, stages.hqaClosure]
            : [stages.investigation, stages.qaFollowUp, stages.hqaClosure];
        let chosen = workflowOrder.find(stage => stage.present && !stage.completed && !/^not started$/i.test(stage.status));
        if (!chosen) chosen = workflowOrder.find(stage => stage.present && !stage.completed);
        if (!chosen) chosen = workflowOrder.slice().reverse().find(stage => stage.present) || (reportType === 'CAR' ? stages.monitor : emptyStage('Unknown'));

        console.log('[HAESL QA Status] Extracted workflow', carId, {reportType, stages, active: chosen});
        return {
            carId,
            reportType,
            url,
            raisedDate,
            activeStage: chosen.name,
            owner: stages.qaFollowUp?.owner || chosen.owner || '',
            targetDate: chosen.targetDate || '',
            status: chosen.status || (chosen.completed ? 'Completed' : 'Not started'),
            stages
        };
    }

    function checkedState(input) {
        if (!input) return false;
        // Use only the live DOM state. Do not use value="true" or the original
        // checked attribute: Ideagen may retain those values on both options or
        // after the user changes the selection.
        return input.checked === true;
    }

    function associatedLabelText(input, doc) {
        if (!input) return '';
        const explicit = input.id
            ? doc.querySelector(`label[for="${CSS.escape(input.id)}"]`)
            : null;
        if (explicit) return normalize(explicit.textContent).toLowerCase();
        const wrapping = input.closest('label');
        if (wrapping) return normalize(wrapping.textContent).toLowerCase();
        const next = input.nextElementSibling;
        if (next) return normalize(next.textContent).toLowerCase();
        return normalize(input.parentElement?.textContent).toLowerCase();
    }

    function findReportableOccurrenceGroup(doc) {
        // The field UUID is not stable between IOR templates/records. Anchor on
        // the exact visible field name and then move up to the containing
        // Ideagen reportField <li>.
        const nodes = [...doc.querySelectorAll('.name,.fieldName,.g-label,legend,label,div,span')];
        const heading = nodes.find(node =>
            normalize(node.textContent).toLowerCase() === 'reportable occurrence to authorities'
        );
        if (!heading) return null;

        return heading.closest('li.g-form__element.reportField, li.reportField, .g-form__element.reportField')
            || heading.closest('.fieldHolder')
            || heading.parentElement?.closest('li')
            || null;
    }

    function elementLabelText(input, doc) {
        if (!input) return '';
        if (input.id) {
            const label = doc.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label) return normalize(label.textContent).toLowerCase();
        }
        const wrapping = input.closest('label');
        if (wrapping) return normalize(wrapping.textContent).toLowerCase();
        const parent = input.parentElement;
        if (parent) {
            const label = parent.querySelector('label');
            if (label) return normalize(label.textContent).toLowerCase();
        }
        return '';
    }

    function detectMORInDocument(doc) {
        const group = findReportableOccurrenceGroup(doc);
        if (!group) return {ready: false, mor: false};

        const checkboxes = [...group.querySelectorAll('.checkboxGroup input[type="checkbox"], input[type="checkbox"]')];
        if (checkboxes.length < 2) return {ready: false, mor: false};

        const options = checkboxes.map(input => ({
            input,
            label: elementLabelText(input, doc),
            checkedProperty: input.checked === true,
            checkedAttribute: input.getAttribute('checked'),
            hasCheckedAttribute: input.hasAttribute('checked')
        }));

        const yes = options.find(option => option.label === 'yes');
        if (!yes) return {ready: false, mor: false};

        // The screenshots show Ideagen rendering the selected option with
        // checked="checked". Use the explicit attribute first and the live DOM
        // property as a fallback. Never use value="true".
        const mor = yes.checkedAttribute === 'checked'
            || yes.hasCheckedAttribute
            || yes.checkedProperty;

        console.log('[Report Status Scanner] Reportable Occurrence field', {
            route: doc.defaultView?.location?.href,
            fieldId: group.getAttribute('data-field-id'),
            options: options.map(o => ({
                label: o.label,
                checkedProperty: o.checkedProperty,
                checkedAttribute: o.checkedAttribute,
                hasCheckedAttribute: o.hasCheckedAttribute,
                id: o.input.id
            })),
            mor
        });

        return {ready: true, mor};
    }

    function reportFormUrl(url) {
        // Stage extraction uses the Workflow/details route. MOR is a Report-form
        // field, so load the same report record with the explicit #!/report route.
        const base = String(url || '').split('#!')[0].split('#')[0];
        return `${base}#!/report`;
    }

    function loadMORFlag(url) {
        return new Promise(resolve => {
            const frame = document.createElement('iframe');
            frame.className = 'hcr-frame';
            frame.setAttribute('aria-hidden', 'true');
            state.frames.add(frame);
            let done = false;
            const finish = value => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                state.frames.delete(frame);
                frame.remove();
                resolve(Boolean(value));
            };
            const timer = setTimeout(() => finish(false), Math.min(CFG.frameTimeoutMs, 25000));

            frame.addEventListener('load', async () => {
                try {
                    const win = frame.contentWindow;
                    const doc = frame.contentDocument;
                    if (!win || !doc || win.location.origin !== location.origin) return finish(false);

                    // #!/report is an SPA route. The iframe load event can occur
                    // before Angular has rendered the Report tab, so poll the DOM
                    // until the exact reportable-occurrence field is ready.
                    const started = Date.now();
                    while (Date.now() - started < 18000) {
                        const result = detectMORInDocument(doc);
                        if (result.ready) return finish(result.mor);
                        await sleep(500);
                    }
                    finish(false);
                } catch (error) {
                    console.warn('[Report Status Scanner] MOR scan failed', error);
                    finish(false);
                }
            }, {once: true});

            frame.src = reportFormUrl(url);
            document.body.appendChild(frame);
        });
    }

    function loadHidden(link) {
        return new Promise((resolve, reject) => {
            const frame = document.createElement('iframe');
            frame.className = 'hcr-frame';
            frame.setAttribute('aria-hidden', 'true');
            state.frames.add(frame);
            let done = false;
            const cleanup = () => { state.frames.delete(frame); frame.remove(); };
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                cleanup();
                reject(new Error('Timed out waiting for report details'));
            }, CFG.frameTimeoutMs);
            frame.addEventListener('load', async () => {
                if (done) return;
                try {
                    const win = frame.contentWindow;
                    const doc = frame.contentDocument;
                    if (!win || !doc) throw new Error('Hidden report document is unavailable');
                    if (win.location.origin !== location.origin) throw new Error('Report frame redirected outside the HAESL origin');
                    await sleep(CFG.ajaxSettleMs);
                    const started = Date.now();
                    while (!doc.querySelector(CFG.selectors.stage) && Date.now() - started < 12000) await sleep(600);
                    const data = extractFromDocument(doc, link.id, link.url);
                    done = true;
                    clearTimeout(timer);
                    cleanup();
                    resolve(data);
                } catch (err) {
                    done = true;
                    clearTimeout(timer);
                    cleanup();
                    reject(err);
                }
            }, {once: true});
            frame.src = link.url.includes('#!/') ? link.url : `${link.url}#!/details`;
            document.body.appendChild(frame);
        });
    }

    async function runScan() {
        if (state.running) return;
        discoverLinks();
        renderDiscovered();
        if (!state.links.length) return;
        state.running = true;
        state.stopRequested = false;
        setButtons(true);
        for (let i = 0; i < state.links.length; i++) {
            if (state.stopRequested) break;
            const link = state.links[i];
            setStatus(`Scanning ${i + 1}/${state.links.length}: ${link.id}`);
            upsertRow(link.id, {carId: link.id, url: link.url, loading: true, scanned: false, stages: null, mor: false, error: '', status: ''});
            try {
                const data = await loadHidden(link);
                if (data.reportType === 'IOR') {
                    setStatus(`Checking MOR flag ${i + 1}/${state.links.length}: ${link.id}`);
                    data.mor = await loadMORFlag(link.url);
                }
                upsertRow(link.id, {...data, loading: false, scanned: true});
            } catch (err) {
                upsertRow(link.id, {carId: link.id, url: link.url, loading: false, scanned: false, stages: null, mor: false, error: err.message});
            }
            if (i < state.links.length - 1 && !state.stopRequested) await sleep(CFG.betweenCarsMs);
        }
        state.running = false;
        setButtons(false);
        setStatus(state.stopRequested ? 'Scan stopped.' : `Scan completed for ${state.links.length} CAR / IOR link(s).`, state.stopRequested ? '' : 'success');
    }

    function stopScan() {
        state.stopRequested = true;
        for (const frame of [...state.frames]) frame.remove();
        state.frames.clear();
        setStatus('Stopping after the current operation…');
    }

    function setButtons(running) {
        document.getElementById('hcr-start').disabled = running;
        document.getElementById('hcr-stop').disabled = !running;
        document.getElementById('hcr-refresh').disabled = running;
    }

    function clearResults() {
        if (state.running) return;
        state.rows.clear();
        const body = document.getElementById('hcr-body');
        if (body) body.innerHTML = '';
        document.getElementById('hcr-csv').disabled = true;
        setStatus('Results cleared.');
    }

    function csvCell(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
    function exportCSV() {
        const rows = [...state.rows.values()];
        if (!rows.length) return;
        const header = ['Report No','Report Type','MOR','Raised Date','Active Stage','Stage Owner','Target Date','Status','Monitor Status','Monitor Target','Investigation Status','Investigation Target','QA Follow Up Status','QA Follow Up Target','HQA Closure Status','HQA Closure Target','URL'];
        const lines = [header.map(csvCell).join(',')];
        for (const r of rows) {
            const st = r.stages || {};
            lines.push([
                r.carId,r.reportType,r.mor ? 'Yes' : 'No',r.raisedDate,r.activeStage,r.owner,r.targetDate,r.error || r.status,
                st.monitor?.status,st.monitor?.targetDate,
                st.investigation?.status,st.investigation?.targetDate,
                st.qaFollowUp?.status,st.qaFollowUp?.targetDate,
                st.hqaClosure?.status,st.hqaClosure?.targetDate,
                r.url
            ].map(csvCell).join(','));
        }
        const blob = new Blob([lines.join('\r\n')], {type:'text/csv;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `HAESL_CAR_IOR_Status_${new Date().toISOString().slice(0,10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function observeRegister() {
        let timer;
        const observer = new MutationObserver(() => {
            if (state.running) return;
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (location.pathname.startsWith(CFG.listPath)) {
                    discoverLinks();
                    document.getElementById('hcr-count').textContent = String(state.links.length);
                }
            }, CFG.scanDebounceMs);
        });
        observer.observe(document.documentElement, {subtree:true, childList:true});
        setInterval(() => {
            if (state.route !== location.href) {
                state.route = location.href;
                if (!state.running) {
                    discoverLinks();
                    renderDiscovered();
                }
            }
        }, 700);
    }

    function init() {
        if (!location.pathname.startsWith(CFG.listPath)) return;
        addStyles();
        createUI();
        discoverLinks();
        renderDiscovered();
        observeRegister();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
    else init();
})();
