(function(){if(window.__ELEMENT_MARKER_INSTALLED__)return;window.__ELEMENT_MARKER_INSTALLED__=!0;const L=window===window.top;function D(e){return new Promise(o=>setTimeout(o,e))}const h={DEFAULTS:{PREFS:{preferId:!0,preferStableAttr:!0,preferClass:!0},SELECTOR_TYPE:"css",LIST_MODE:!1},Z_INDEX:{OVERLAY:2147483646,HIGHLIGHTER:2147483645,RECTS:2147483644},COLORS:{PRIMARY:"#2563eb",SUCCESS:"#10b981",WARNING:"#f59e0b",DANGER:"#ef4444",HOVER:"#10b981",VERIFY:"#3b82f6"}},y=(()=>{let e=null,o=null;const t=`
      * {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
      }

      .em-panel {
        width: 400px;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        padding: 20px;
        transition: opacity 150ms ease;
      }


      /* Header */
      .em-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 20px;
        user-select: none;
      }

      .em-title {
        font-size: 20px;
        font-weight: 500;
        color: #262626;
      }

      .em-header-actions {
        display: flex;
        gap: 4px;
        align-items: center;
      }

      .em-icon-btn {
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: #a3a3a3;
        cursor: pointer;
        transition: color 150ms ease;
        padding: 0;
      }

      .em-icon-btn:hover {
        color: #525252;
      }

      .em-icon-btn svg {
        width: 20px;
        height: 20px;
        stroke-width: 2;
      }

      /* Controls Row */
      .em-controls {
        display: flex;
        gap: 8px;
        margin-bottom: 12px;
      }

      .em-select-wrapper {
        flex: 1;
        position: relative;
      }

      .em-select {
        width: 100%;
        height: 44px;
        padding: 0 40px 0 16px;
        background: #f5f5f5;
        color: #262626;
        font-size: 15px;
        border: none;
        border-radius: 10px;
        appearance: none;
        cursor: pointer;
        outline: none;
        font-family: inherit;
        font-weight: 400;
      }

      .em-select-wrapper::after {
        content: '';
        position: absolute;
        right: 16px;
        top: 50%;
        transform: translateY(-50%);
        width: 0;
        height: 0;
        border-left: 5px solid transparent;
        border-right: 5px solid transparent;
        border-top: 6px solid #737373;
        pointer-events: none;
      }

      .em-square-btn {
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f5f5f5;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        transition: background 150ms ease;
        padding: 0;
      }

      .em-square-btn:hover {
        background: #e5e5e5;
      }

      .em-square-btn.active {
        background: #2563eb;
      }

      .em-square-btn.active svg {
        color: #ffffff;
      }

      .em-square-btn svg {
        width: 18px;
        height: 18px;
        color: #525252;
        stroke-width: 2;
      }

      /* Selector Display */
      .em-selector-display {
        display: flex;
        align-items: center;
        gap: 10px;
        height: 44px;
        padding: 0 12px 0 16px;
        background: #f5f5f5;
        border-radius: 10px;
        margin-bottom: 16px;
      }

      .em-selector-display svg {
        width: 18px;
        height: 18px;
        color: #a3a3a3;
        flex-shrink: 0;
        stroke-width: 2;
      }

      .em-selector-text {
        flex: 1;
        font-size: 14px;
        color: #525252;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        user-select: text;
      }

      .em-selector-nav {
        display: flex;
        gap: 2px;
      }

      .em-nav-btn {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        cursor: pointer;
        transition: background 150ms ease;
        border-radius: 6px;
        padding: 0;
      }

      .em-nav-btn:hover {
        background: #e5e5e5;
      }

      .em-nav-btn svg {
        width: 16px;
        height: 16px;
        color: #525252;
        stroke-width: 2;
      }

      /* Tabs */
      .em-tabs {
        display: inline-flex;
        gap: 2px;
        padding: 2px;
        background: #f5f5f5;
        border-radius: 8px;
        margin-bottom: 16px;
      }

      .em-tab {
        padding: 6px 16px;
        font-size: 12px;
        font-weight: 500;
        color: #737373;
        background: transparent;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all 150ms ease;
      }

      .em-tab:hover {
        color: #404040;
      }

      .em-tab.active {
        color: #262626;
        background: #ffffff;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      /* Content */
      .em-content {
        margin-bottom: 0;
      }

      #__em_tab_settings {
        max-height: min(60vh, 480px);
        overflow-y: auto;
        scrollbar-width: none; /* Firefox */
        -ms-overflow-style: none; /* IE and Edge */
      }

      #__em_tab_settings::-webkit-scrollbar {
        display: none; /* Chrome, Safari, Opera */
      }

      .em-section-title {
        font-size: 13px;
        color: #737373;
        margin-bottom: 16px;
        font-weight: 400;
      }

      .em-attributes {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .em-attribute {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .em-attribute-label {
        font-size: 12px;
        color: #a3a3a3;
        font-weight: 400;
      }

      .em-attribute-value {
        display: flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        padding: 0 12px 0 16px;
        background: #f5f5f5;
        border-radius: 10px;
      }

      .em-attribute-value.editable {
        padding: 0 16px;
      }

      .em-attribute-value svg {
        width: 18px;
        height: 18px;
        stroke-width: 2;
        cursor: pointer;
        transition: color 150ms ease;
        flex-shrink: 0;
      }

      .em-attribute-value svg.copy-icon {
        color: #a3a3a3;
      }

      .em-attribute-value svg.copy-icon:hover {
        color: #525252;
      }

      .em-attribute-value svg.copy-icon.disabled {
        color: #d4d4d4;
        cursor: default;
      }

      .em-attribute-text {
        flex: 1;
        font-size: 14px;
        color: #404040;
        user-select: text;
      }

      .em-attribute-text.empty {
        color: #a3a3a3;
      }

      .em-input {
        flex: 1;
        border: none;
        background: transparent;
        font-size: 14px;
        color: #404040;
        font-family: inherit;
        outline: none;
        padding: 0;
        height: 44px;
      }

      .em-input::placeholder {
        color: #a3a3a3;
      }

      /* Settings Panel */
      .em-settings {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .em-settings-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .em-settings-label {
        font-size: 12px;
        font-weight: 500;
        color: #737373;
      }

      .em-checkbox-group {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .em-checkbox-label {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        color: #404040;
        cursor: pointer;
      }

      .em-checkbox-label input[type="checkbox"] {
        width: 18px;
        height: 18px;
        cursor: pointer;
        margin: 0;
      }

      /* Action Buttons */
      .em-actions {
        display: flex;
        gap: 8px;
        margin-top: 20px;
      }

      .em-btn {
        flex: 1;
        height: 40px;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        transition: all 150ms ease;
      }

      .em-btn-primary {
        background: #2563eb;
        color: #ffffff;
      }

      .em-btn-primary:hover {
        background: #1d4ed8;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
      }

      .em-btn-success {
        background: #10b981;
        color: #ffffff;
      }

      .em-btn-success:hover {
        background: #059669;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
      }

      .em-btn-ghost {
        background: #f5f5f5;
        color: #404040;
      }

      .em-btn-ghost:hover {
        background: #e5e5e5;
      }

      /* Footer */
      .em-footer {
        font-size: 12px;
        color: #a3a3a3;
        text-align: center;
        margin-top: 16px;
      }

      .em-footer kbd {
        display: inline-block;
        padding: 2px 6px;
        background: #f5f5f5;
        border-radius: 4px;
        font-family: monospace;
        font-size: 11px;
        color: #737373;
      }

      /* Status */
      .em-status {
        font-size: 13px;
        padding: 10px 12px;
        border-radius: 8px;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .em-status.idle {
        display: none;
      }

      .em-status.running {
        background: rgba(37, 99, 235, 0.1);
        color: #2563eb;
      }

      .em-status.success {
        background: rgba(16, 185, 129, 0.1);
        color: #10b981;
      }

      .em-status.failure {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
      }

      /* Grid Layout */
      .em-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 12px;
      }

      .em-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .em-field-label {
        font-size: 12px;
        color: #a3a3a3;
      }

      .em-field-input {
        height: 40px;
        padding: 0 12px;
        background: #f5f5f5;
        border: none;
        border-radius: 8px;
        font-size: 14px;
        color: #404040;
        font-family: inherit;
        outline: none;
      }

      .em-field-input:focus {
        background: #e5e5e5;
      }

      /* Details/Accordion */
      .em-details {
        margin-top: 12px;
        padding-top: 12px;
        border-top: 1px solid #f5f5f5;
      }

      .em-details summary {
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        color: #737373;
        padding: 8px 0;
        user-select: none;
        list-style: none;
      }

      .em-details summary::-webkit-details-marker {
        display: none;
      }

      .em-details summary:hover {
        color: #404040;
      }

      .em-details[open] summary {
        margin-bottom: 12px;
      }

      /* Dragging state */
      body[data-em-dragging] {
        user-select: none !important;
        cursor: grabbing !important;
      }

      body[data-em-dragging] * {
        cursor: grabbing !important;
      }

      /* SVG Icons */
      svg {
        fill: none;
        stroke: currentColor;
      }

      .em-drag-handle {
        cursor: grab;
      }

      .em-drag-handle:active {
        cursor: grabbing;
      }
    `,n=`
      <div class="em-panel" id="em_panel_root">
        <!-- Header -->
        <div class="em-header em-drag-handle" id="__em_drag_handle" title="Drag to move">
          <h2 class="em-title">\u5143\u7D20\u6807\u6CE8</h2>
          <div class="em-header-actions">
            <button class="em-icon-btn" id="__em_close" title="Close">
              <svg viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Controls -->
        <div class="em-controls">
          <div class="em-select-wrapper">
            <select class="em-select" id="__em_selector_type">
              <option value="css">CSS Selector</option>
              <option value="xpath">XPath</option>
            </select>
          </div>
          <button class="em-square-btn" id="__em_toggle_list" title="\u5217\u8868\u6A21\u5F0F - \u6279\u91CF\u6807\u6CE8\u76F8\u4F3C\u5143\u7D20 (\u4EC5\u652F\u6301CSS)">
            <svg viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/>
            </svg>
          </button>
          <button class="em-square-btn" id="__em_toggle_tab" title="Toggle Execute tab">
            <svg viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
          </button>
        </div>

        <!-- Selector Display -->
        <div class="em-selector-display">
          <svg viewBox="0 0 24 24" id="__em_copy_selector" title="Copy selector">
            <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
          </svg>
          <span class="em-selector-text" id="__em_selector_text">Click an element to select</span>
          <div class="em-selector-nav">
            <button class="em-nav-btn" id="__em_nav_up" title="Select parent">
              <svg viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 15l7-7 7 7"/>
              </svg>
            </button>
            <button class="em-nav-btn" id="__em_nav_down" title="Select child">
              <svg viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
              </svg>
            </button>
          </div>
        </div>

        <!-- Tabs -->
        <div class="em-tabs">
          <button class="em-tab active" data-tab="attributes">Attributes</button>
          <button class="em-tab" data-tab="execute">Execute</button>
        </div>

        <!-- Status -->
        <div class="em-status idle" id="__em_status"></div>

        <!-- Content: Attributes Tab -->
        <div class="em-content" id="__em_tab_attributes">
          <h3 class="em-section-title">#1 Element</h3>
          
          <div class="em-attributes">
            <div class="em-attribute">
              <div class="em-attribute-label">name</div>
              <div class="em-attribute-value editable">
                <input class="em-input" id="__em_name" placeholder="Element name" />
              </div>
            </div>

            <div class="em-attribute">
              <div class="em-attribute-label">selector</div>
              <div class="em-attribute-value">
                <svg class="copy-icon" viewBox="0 0 24 24" id="__em_copy" title="Copy">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
                <span class="em-attribute-text" id="__em_selector">-</span>
              </div>
            </div>
          </div>

          <h3 class="em-section-title">Selector Preferences</h3>
          <div class="em-settings">
            <div class="em-checkbox-group">
              <label class="em-checkbox-label">
                <input type="checkbox" id="__em_pref_id" checked />
                <span>Prefer ID</span>
              </label>
              <label class="em-checkbox-label">
                <input type="checkbox" id="__em_pref_attr" checked />
                <span>Prefer stable attributes</span>
              </label>
              <label class="em-checkbox-label">
                <input type="checkbox" id="__em_pref_class" checked />
                <span>Prefer class names</span>
              </label>
            </div>
          </div>

          <div class="em-actions">
            <button class="em-btn em-btn-primary" id="__em_verify">Verify (Highlight Only)</button>
          </div>

          <div class="em-actions">
            <button class="em-btn em-btn-success" id="__em_save">Save</button>
            <button class="em-btn em-btn-ghost" id="__em_cancel">Cancel</button>
          </div>
        </div>

        <!-- Content: Execute Tab -->
        <div class="em-content" id="__em_tab_execute" style="display: none;">
          <div class="em-settings">
            <div class="em-settings-group">
              <div class="em-settings-label">Action</div>
              <div class="em-select-wrapper">
                <select class="em-select" id="__em_action">
                  <option value="hover">Hover</option>
                  <option value="left_click">Left click</option>
                  <option value="double_click">Double click</option>
                  <option value="right_click">Right click</option>
                  <option value="scroll">Scroll</option>
                  <option value="type_text">Type text</option>
                  <option value="press_keys">Press keys</option>
                </select>
              </div>
            </div>

            <!-- Action-specific inputs (dynamically shown/hidden) -->
            <div class="em-settings-group" id="__em_action_text_group" style="display: none;">
              <div class="em-settings-label">Text</div>
              <input class="em-field-input" id="__em_action_text" placeholder="Text to type" />
            </div>

            <div class="em-settings-group" id="__em_action_keys_group" style="display: none;">
              <div class="em-settings-label">Keys</div>
              <input class="em-field-input" id="__em_action_keys" placeholder="Keys to press (e.g., Enter, Ctrl+C)" />
            </div>

            <div class="em-settings-group" id="__em_scroll_options" style="display: none;">
              <div class="em-settings-label">Scroll Direction</div>
              <div class="em-select-wrapper">
                <select class="em-select" id="__em_scroll_direction">
                  <option value="down">Down</option>
                  <option value="up">Up</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </div>
              <div class="em-field" style="margin-top: 8px;">
                <div class="em-field-label">Amount (1-10, ~100px each)</div>
                <input class="em-field-input" id="__em_scroll_distance" type="number" min="1" max="10" step="1" value="3" />
              </div>
            </div>

            <!-- Click-specific options -->
            <div id="__em_click_options" style="display: none;">
              <div class="em-grid">
                <div class="em-field">
                  <div class="em-field-label">Button</div>
                  <select class="em-select" id="__em_btn">
                    <option value="left">Left</option>
                    <option value="middle">Middle</option>
                    <option value="right">Right</option>
                  </select>
                </div>
                <div class="em-field">
                  <div class="em-field-label">Timeout (ms)</div>
                  <input class="em-field-input" id="__em_nav_timeout" type="number" value="3000" />
                </div>
              </div>

              <div class="em-checkbox-group" style="margin-top: 12px;">
                <label class="em-checkbox-label">
                  <input type="checkbox" id="__em_wait_nav" />
                  <span>Wait for navigation</span>
                </label>
                <label class="em-checkbox-label">
                  <input type="checkbox" id="__em_mod_alt" />
                  <span>Alt key</span>
                </label>
                <label class="em-checkbox-label">
                  <input type="checkbox" id="__em_mod_ctrl" />
                  <span>Ctrl key</span>
                </label>
                <label class="em-checkbox-label">
                  <input type="checkbox" id="__em_mod_meta" />
                  <span>Meta key</span>
                </label>
                <label class="em-checkbox-label">
                  <input type="checkbox" id="__em_mod_shift" />
                  <span>Shift key</span>
                </label>
              </div>
            </div>

            <div class="em-actions" style="margin-top: 16px;">
              <button class="em-btn em-btn-primary" id="__em_execute">Execute</button>
            </div>

            <!-- Execution History -->
            <div id="__em_execution_history" style="margin-top: 16px; display: none;">
              <div class="em-settings-label">Recent Executions</div>
              <div id="__em_history_list" style="font-size: 12px; color: #737373; margin-top: 8px;"></div>
            </div>
          </div>
        </div>

        <!-- Footer -->
        <div class="em-footer">
          Click or press <kbd>Space</kbd> to select an element
        </div>
      </div>
    `;function s(){if(e)return{host:e,shadow:o};e=document.createElement("div"),e.id="__element_marker_overlay",Object.assign(e.style,{position:"fixed",top:"24px",right:"24px",zIndex:String(h.Z_INDEX.OVERLAY),pointerEvents:"none"}),o=e.attachShadow({mode:"open"}),o.innerHTML=`<style>${t}</style>${n}`,e.querySelector=(...c)=>o.querySelector(...c),e.querySelectorAll=(...c)=>o.querySelectorAll(...c);const d=o.querySelector(".em-panel");return d&&(d.style.pointerEvents="auto"),document.documentElement.appendChild(e),{host:e,shadow:o}}function i(){e?.parentNode&&e.parentNode.removeChild(e),e=null,o=null}function a(){return e}function l(){return o}return{mount:s,unmount:i,getHost:a,getShadow:l}})(),u=(()=>{const e={selectorType:h.DEFAULTS.SELECTOR_TYPE,listMode:h.DEFAULTS.LIST_MODE,prefs:{...h.DEFAULTS.PREFS},activeTab:"attributes",validation:{status:"idle",message:""},validationHistory:[]},o=new Set;function t(){return e}function n(p){return p?e[p]:e}function s(p){const f={};Object.keys(p).forEach(g=>{JSON.stringify(e[g])!==JSON.stringify(p[g])&&(f[g]=!0,e[g]=p[g])}),Object.keys(f).length!==0&&(f.validation&&l(),f.activeTab&&c(),f.listMode&&d(),f.validationHistory&&m(),a())}function i(p){return o.add(p),()=>o.delete(p)}function a(){o.forEach(p=>{try{p(e)}catch(f){console.error("[StateStore] Listener error:",f)}})}function l(){const p=y.getShadow()?.getElementById("__em_status");if(!p)return;const{status:f,message:g}=e.validation;p.className=`em-status ${f}`,p.textContent=g}function d(){const p=y.getShadow();if(!p)return;const f=p.getElementById("__em_toggle_list");f&&(e.listMode?f.classList.add("active"):f.classList.remove("active"))}function c(){const p=y.getShadow();if(!p)return;p.querySelectorAll(".em-tab").forEach(v=>{v.dataset.tab===e.activeTab?v.classList.add("active"):v.classList.remove("active")});const g=p.getElementById("__em_tab_attributes"),_=p.getElementById("__em_tab_execute");g&&(g.style.display=e.activeTab==="attributes"?"block":"none"),_&&(_.style.display=e.activeTab==="execute"?"block":"none"),Z()}function m(){const p=y.getShadow();if(!p)return;const f=p.getElementById("__em_execution_history"),g=p.getElementById("__em_history_list");if(!(!f||!g)){if(e.validationHistory.length===0){f.style.display="none";return}f.style.display="block",g.innerHTML=e.validationHistory.slice(-5).reverse().map(_=>{const v=_.success?"\u2713":"\u2717",O=_.success?"#10b981":"#ef4444",E=new Date(_.timestamp).toLocaleTimeString();return`<div style="padding: 6px 0; border-bottom: 1px solid #f5f5f5;">
            <span style="color: ${O}; font-weight: 600;">${v}</span>
            <span style="margin-left: 6px;">${_.action}</span>
            <span style="float: right; color: #a3a3a3; font-size: 11px;">${E}</span>
          </div>`}).join("")}}return{init:t,get:n,set:s,subscribe:i}})(),P=(()=>{let e=!1,o={x:0,y:0},t={top:0,right:0};function n(d){d&&d.addEventListener("mousedown",s)}function s(d){d.preventDefault(),e=!0;const c=y.getHost();c&&(o={x:d.clientX,y:d.clientY},t={top:parseInt(c.style.top)||0,right:parseInt(c.style.right)||0},document.addEventListener("mousemove",i,{capture:!0,passive:!1}),document.addEventListener("mouseup",a,{capture:!0,passive:!1}),document.body.setAttribute("data-em-dragging","true"))}function i(d){if(!e)return;d.preventDefault(),d.stopPropagation();const c=y.getHost();if(!c)return;const m=d.clientX-o.x,p=d.clientY-o.y,f=Math.max(8,t.top+p),g=Math.max(8,t.right-m);c.style.top=`${f}px`,c.style.right=`${g}px`}function a(d){e&&(d.preventDefault(),d.stopPropagation(),e=!1,document.removeEventListener("mousemove",i,{capture:!0}),document.removeEventListener("mouseup",a,{capture:!0}),document.body.removeAttribute("data-em-dragging"))}function l(){e&&a(new MouseEvent("mouseup"))}return{init:n,destroy:l}})();function S(e){if(!(e instanceof Element))return"";const o=u.get("prefs");if(o.preferId&&e.id){const t=`#${CSS.escape(e.id)}`;if(b(t,e))return t}if(o.preferStableAttr){const t=["data-testid","data-testId","data-test","data-qa","data-cy","name","title","alt","aria-label"],n=e.tagName.toLowerCase();for(const s of t){const i=e.getAttribute(s);if(!i)continue;const a=`[${s}="${CSS.escape(i)}"]`,l=/^(input|textarea|select)$/i.test(n)?`${n}${a}`:a;if(b(l,e))return l}}if(o.preferClass)try{const t=Array.from(e.classList||[]).filter(s=>s&&/^[a-zA-Z0-9_-]+$/.test(s)),n=e.tagName.toLowerCase();for(const s of t){const i=`.${CSS.escape(s)}`;if(b(i,e))return i}for(const s of t){const i=`${n}.${CSS.escape(s)}`;if(b(i,e))return i}for(let s=0;s<Math.min(t.length,3);s++)for(let i=s+1;i<Math.min(t.length,3);i++){const a=`.${CSS.escape(t[s])}.${CSS.escape(t[i])}`;if(b(a,e))return a}}catch{}if(o.preferStableAttr)try{let t=e;const n=["id","data-testid","data-testId","data-test","data-qa","data-cy","name"],s=e.getRootNode(),a=s instanceof ShadowRoot?s.host:document.body;for(;t&&t!==a;){if(t.id){const l=`#${CSS.escape(t.id)}`;if(b(l,t)){const d=A(t,e),c=d?`${l} ${d}`:l;if(b(c,e))return c}}for(const l of n){const d=t.getAttribute(l);if(!d)continue;const c=`[${l}="${CSS.escape(d)}"]`;if(b(c,t)){const m=A(t,e),p=m?`${c} ${m}`:c;if(b(p,e))return p}}t=t.parentElement}}catch{}return ne(e)}function A(e,o){const t=[];let n=o;const s=o.getRootNode(),i=s instanceof ShadowRoot,a=i?s.host:document.body;for(;n&&n!==e&&n!==a;){let l=n.tagName.toLowerCase();const d=n.parentElement;if(d){const c=Array.from(d.children).filter(m=>m.tagName===n.tagName);c.length>1&&(l+=`:nth-of-type(${c.indexOf(n)+1})`)}if(t.unshift(l),n=d,i&&n===a)break}return t.join(" > ")}function ne(e){let o="",t=e;const n=e.getRootNode(),s=n instanceof ShadowRoot,i=s?n.host:document.body;for(;t&&t.nodeType===Node.ELEMENT_NODE&&t!==i;){let a=t.tagName.toLowerCase();const l=t.parentElement;if(l){const d=Array.from(l.children).filter(c=>c.tagName===t.tagName);d.length>1&&(a+=`:nth-of-type(${d.indexOf(t)+1})`)}if(o=o?`${a} > ${o}`:a,t=l,s&&t===i)break}return s?o||e.tagName.toLowerCase():o?`body > ${o}`:"body"}function F(e){if(!(e instanceof Element))return"";if(e.id)return`//*[@id="${e.id}"]`;const o=[];let t=e;for(;t&&t.nodeType===1&&t!==document.documentElement;){const n=t.tagName.toLowerCase();if(t.id){o.unshift(`//*[@id="${t.id}"]`);break}let s=1,i=t;for(;i=i.previousElementSibling;)i.tagName.toLowerCase()===n&&s++;o.unshift(`${n}[${s}]`),t=t.parentElement}return o[0]?.startsWith("//*")?o.join("/"):"//"+o.join("/")}function z(e){const t=q(e)?.[0]||e,n=t.parentElement;if(!n)return S(e);const s=S(n),i=se(t,n);return s&&i?`${s} ${i}`:S(e)}function se(e,o){if(!(e instanceof Element))return"";const t=e.tagName.toLowerCase();if(e.id){const s=`#${CSS.escape(e.id)}`;if(b(s,e))return s}const n=["data-testid","data-testId","data-test","data-qa","data-cy","name","title","alt","aria-label"];for(const s of n){const i=e.getAttribute(s);if(!i)continue;const a=`[${s}="${CSS.escape(i)}"]`,l=/^(input|textarea|select)$/i.test(t)?`${t}${a}`:a;if(b(l,e))return l}try{const s=Array.from(e.classList||[]).filter(i=>i&&/^[a-zA-Z0-9_-]+$/.test(i));for(const i of s){const a=`.${CSS.escape(i)}`;if(b(a,e))return a}for(const i of s){const a=`${t}.${CSS.escape(i)}`;if(b(a,e))return a}}catch{}return A(o,e)}function ie(e){try{const o=e.getAttribute("aria-labelledby");if(o){const s=document.getElementById(o);if(s)return(s.textContent||"").trim()}const t=e.getAttribute("aria-label");if(t)return t.trim();if(e.id){const s=document.querySelector(`label[for="${e.id}"]`);if(s)return(s.textContent||"").trim()}const n=e.closest("label");return n?(n.textContent||"").trim():(e.getAttribute("placeholder")||e.getAttribute("value")||e.textContent||"").trim()}catch{return""}}function re(e,o){const t=[e],n=l=>{let c=e.tagName===l.tagName;if(o)try{c=c&&!!l.querySelector(o)}catch{}return c};let s=e,i=e,a=1;for(;i=i?.previousElementSibling;)n(i)&&(a+=1,t.unshift(i));for(;s=s?.nextElementSibling;)n(s)&&t.push(s);return{elements:t,index:a}}function j(e,o=50,t=[]){if(o===0||!e||e.tagName==="BODY")return null;let n=e.tagName.toLowerCase();const{elements:s,index:i}=re(e,t.join(" > "));let a=s;return i!==1&&(n+=`:nth-of-type(${i})`),t.unshift(n),a.length===1&&(a=j(e.parentElement,o-1,t)),a}function q(e){try{return j(e)||[e]}catch{return[e]}}function*ae(e){const o=[e];let t=0;const n=1e4;for(;o.length;){const s=o.pop();if(!(!s||++t>n)&&!w(s)){yield s;try{if(s.children){const i=Array.from(s.children);for(let a=i.length-1;a>=0;a--)o.push(i[a])}if(s.shadowRoot?.children){const i=Array.from(s.shadowRoot.children);for(let a=i.length-1;a>=0;a--)o.push(i[a])}}catch{}}}}function T(e){const o=[];for(const t of ae(document))if(t instanceof Element)try{t.matches(e)&&o.push(t)}catch{}return o}function b(e,o){if(!e||!(o instanceof Element))return!1;try{const t=T(e);return t.length===1&&t[0]===o}catch{return!1}}function R(e){try{const o=[],t=document.evaluate(e,document,null,XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,null);for(let n=0;n<t.snapshotLength;n++){const s=t.snapshotItem(n);s?.nodeType===1&&!w(s)&&o.push(s)}return o}catch{return[]}}const r={active:!1,hoverEl:null,selectedEl:null,box:null,highlighter:null,listenersAttached:!1,rectsHost:null,hoveredList:[],verifyRectsActive:!1,hoverRafId:null,lastHoverTarget:null,rectPool:[],rectPoolUsed:0};function B(){if(r.highlighter)return r.highlighter;const e=document.createElement("div");return e.id="__element_marker_highlight",Object.assign(e.style,{position:"fixed",zIndex:String(h.Z_INDEX.HIGHLIGHTER),pointerEvents:"none",border:`2px solid ${h.COLORS.HOVER}`,borderRadius:"4px",boxShadow:`0 0 0 2px ${h.COLORS.HOVER}33`,transition:"all 100ms ease-out"}),document.documentElement.appendChild(e),r.highlighter=e,e}function U(){if(r.rectsHost)return r.rectsHost;const e=document.createElement("div");return e.id="__element_marker_rects",Object.assign(e.style,{position:"fixed",zIndex:String(h.Z_INDEX.RECTS),pointerEvents:"none",inset:"0"}),document.documentElement.appendChild(e),r.rectsHost=e,e}function V(e){const o=B(),t=e.getBoundingClientRect();o.style.left=`${t.left}px`,o.style.top=`${t.top}px`,o.style.width=`${t.width}px`,o.style.height=`${t.height}px`,o.style.display="block"}function $(){r.highlighter&&(r.highlighter.style.display="none"),r.verifyRectsActive||I()}function I(){const e=r.rectPoolUsed||0;for(let o=0;o<e;o++){const t=r.rectPool[o];t&&(t.style.display="none")}r.rectPoolUsed=0,r.verifyRectsActive=!1,r.lastHoverTarget=null}function le(e,o){let t=r.rectPool[o];return t||(t=document.createElement("div"),Object.assign(t.style,{position:"fixed",pointerEvents:"none",borderRadius:"4px",transition:"all 100ms ease-out",display:"none"}),r.rectPool[o]=t),t.isConnected||e.appendChild(t),t}const ce=100;function Y(e,{color:o=h.COLORS.HOVER,dashed:t=!0,offsetX:n=0,offsetY:s=0,isVerify:i=!1}={}){const a=U(),l=r.rectPoolUsed||0,d=Math.min(Array.isArray(e)?e.length:0,ce);for(let c=0;c<d;c++){const m=e[c];if(!m)continue;const p=Number.isFinite(m.left)?m.left:Number.isFinite(m.x)?m.x:0,f=Number.isFinite(m.top)?m.top:Number.isFinite(m.y)?m.y:0,g=Number.isFinite(m.width)?m.width:0,_=Number.isFinite(m.height)?m.height:0,v=le(a,c);Object.assign(v.style,{left:`${n+p}px`,top:`${s+f}px`,width:`${g}px`,height:`${_}px`,border:`2px ${t?"dashed":"solid"} ${o}`,boxShadow:`0 0 0 2px ${o}22`,display:"block"})}for(let c=d;c<l;c++){const m=r.rectPool[c];m&&(m.style.display="none")}r.rectPoolUsed=d,r.verifyRectsActive=i}function C(e,o=h.COLORS.HOVER,t=!0,n=!1){const s=e.map(i=>{const a=i.getBoundingClientRect();return{x:a.left,y:a.top,width:a.width,height:a.height}});Y(s,{color:o,dashed:t,isVerify:n})}function N(e){const o=y.getShadow();return!!o&&e instanceof Node&&o.contains(e)}function w(e){if(!(e instanceof Node))return!1;const o=y.getHost();if(!o)return!1;if(e===o)return!0;const t=typeof e.getRootNode=="function"?e.getRootNode():null;return t instanceof ShadowRoot&&t.host===o}function H(e){return Array.isArray(e)?e.filter(o=>!w(o)):[]}function X(e){if(!e)return null;try{const t=typeof e.composedPath=="function"?e.composedPath():null;if(Array.isArray(t)&&t.length>0){for(const n of t)if(n instanceof Element&&!w(n))return n}}catch{}const o=e.target instanceof Element?e.target:null;return o&&!w(o)?o:null}let M=null;function de(e){if(!r.active)return;const o=e?.target;if(!(o instanceof Element)){r.hoverEl=null,r.lastHoverTarget=null,$();return}const t=y.getHost();if(t&&o===t||N(o)){r.hoverEl=null,r.lastHoverTarget=null,$();return}const n=X(e)||o;r.hoverEl=n;let s=!1;try{s=!!u.get("listMode")}catch{}const i=r.lastHoverTarget;if(!(i&&i.element===n&&i.listMode===s)){if(r.lastHoverTarget={element:n,listMode:s},!L){try{const l=(s?q(n)||[n]:[n]).map(d=>{const c=d.getBoundingClientRect();return{x:c.left,y:c.top,width:c.width,height:c.height}});window.top.postMessage({type:"em_hover",rects:l},"*")}catch{}return}s?(r.hoveredList=q(n)||[n],C(r.hoveredList)):V(n)}}function K(e){r.active&&(M=e,r.hoverRafId==null&&(r.hoverRafId=requestAnimationFrame(()=>{r.hoverRafId=null;const o=M;M=null,o&&de(o)})))}function G(){r.listenersAttached||(window.addEventListener("mousemove",K,!0),window.addEventListener("click",J,!0),r.listenersAttached=!0)}function W(){r.listenersAttached&&(window.removeEventListener("mousemove",K,!0),window.removeEventListener("click",J,!0),r.listenersAttached=!1)}function ue(){window.addEventListener("keydown",Q,!0)}function pe(){window.removeEventListener("keydown",Q,!0)}function Z(){if(!r.active)return;u.get("activeTab")==="execute"?(W(),r.highlighter&&(r.highlighter.style.display="none")):G()}function J(e){if(!r.active)return;const o=e.target,t=y.getHost();if(t&&o===t||N(o)||(e.preventDefault(),e.stopPropagation(),!(o instanceof Element)))return;const n=X(e)||o;if(!L){try{const s=u.get("selectorType"),i=u.get("listMode"),a=s==="xpath"?F(n):i?z(n):S(n);window.top.postMessage({type:"em_click",innerSel:a},"*")}catch{}return}x(n)}function Q(e){if(!r.active||N(e.target)&&e.key!=="Escape")return;if(u.get("activeTab")==="execute"){e.key==="Escape"&&(e.preventDefault(),k());return}if(e.key==="Escape")e.preventDefault(),k();else if(e.key===" "||e.code==="Space"){e.preventDefault();const t=r.hoverEl||r.selectedEl;t&&x(t)}else if(e.key==="ArrowUp"){e.preventDefault();const t=r.selectedEl||r.hoverEl;t?.parentElement&&x(t.parentElement)}else if(e.key==="ArrowDown"){e.preventDefault();const t=r.selectedEl||r.hoverEl;t?.firstElementChild&&x(t.firstElementChild)}}function x(e){if(!(e instanceof Element))return;r.selectedEl=e;const o=u.get("selectorType"),t=u.get("listMode"),n=o==="xpath"?F(e):t?z(e):S(e),s=ie(e)||e.tagName.toLowerCase(),i=r.box?.querySelector("#__em_selector"),a=r.box?.querySelector("#__em_name"),l=r.box?.querySelector("#__em_selector_text");i&&(i.textContent=n),l&&(l.textContent=n),a&&!a.value&&(a.value=s),V(e)}async function fe(){try{const e=r.box?.querySelector("#__em_selector")?.textContent?.trim();if(!e)return;u.set({validation:{status:"running",message:"Verifying selector..."}});const o=u.get("selectorType"),s=(u.get("listMode")?"css":o)==="xpath"?R(e):T(e),i=H(s);if(!i||i.length===0){u.set({validation:{status:"failure",message:"No elements found"}});return}const a=i[0];a&&a.scrollIntoView({block:"center",inline:"center",behavior:"smooth"}),await D(200),C(i,h.COLORS.VERIFY,!1,!0),u.set({validation:{status:"success",message:`Found ${i.length} element${i.length>1?"s":""}`}}),setTimeout(()=>{I(),u.set({validation:{status:"idle",message:""}})},2e3)}catch(e){console.error("[verifyHighlightOnly] error:",e),u.set({validation:{status:"failure",message:e.message||"Verification failed"}})}}async function me(){try{const e=r.box?.querySelector("#__em_selector")?.textContent?.trim();if(!e)return;u.set({validation:{status:"running",message:"Executing action..."}});const o=u.get("selectorType"),t=u.get("listMode"),n=t?"css":o,s=n==="xpath"?R(e):T(e),i=H(s);if(!i||i.length===0){u.set({validation:{status:"failure",message:"No elements found"}});return}C(i,h.COLORS.VERIFY,!1);const a=r.box?.querySelector("#__em_action")?.value||"hover",l={type:"element_marker_validate",selector:e,selectorType:n,action:a,listMode:t};if(a==="type_text"){const f=String(r.box?.querySelector("#__em_action_text")?.value||"").trim();if(!f){u.set({validation:{status:"failure",message:"Text is required for type_text"}});return}l.text=f}if(a==="press_keys"){const f=String(r.box?.querySelector("#__em_action_keys")?.value||"").trim();if(!f){u.set({validation:{status:"failure",message:"Keys are required for press_keys"}});return}l.keys=f}if(a==="scroll"){const f=r.box?.querySelector("#__em_scroll_direction")?.value||"down",g=Number(r.box?.querySelector("#__em_scroll_distance")?.value),_=Math.max(1,Math.min(Math.round(Number.isFinite(g)?g:3),10));l.scrollDirection=f,l.scrollAmount=_}["left_click","double_click","right_click"].includes(a)&&(l.modifiers={altKey:!!r.box?.querySelector("#__em_mod_alt")?.checked,ctrlKey:!!r.box?.querySelector("#__em_mod_ctrl")?.checked,metaKey:!!r.box?.querySelector("#__em_mod_meta")?.checked,shiftKey:!!r.box?.querySelector("#__em_mod_shift")?.checked},l.button=r.box?.querySelector("#__em_btn")?.value||"left",l.waitForNavigation=!!r.box?.querySelector("#__em_wait_nav")?.checked,l.timeoutMs=Number(r.box?.querySelector("#__em_nav_timeout")?.value)||3e3);const d=await chrome.runtime.sendMessage(l),c=!!d?.tool?.ok,m={action:a,success:c,timestamp:Date.now(),matchCount:i.length},p=[...u.get("validationHistory")||[],m].slice(-5);d?.tool?.ok?u.set({validation:{status:"success",message:`\u2713 \u9A8C\u8BC1\u6210\u529F (\u5339\u914D ${i.length} \u4E2A\u5143\u7D20)`},validationHistory:p}):u.set({validation:{status:"failure",message:d?.tool?.error||"\u9A8C\u8BC1\u5931\u8D25"},validationHistory:p})}catch(e){const o={action:r.box?.querySelector("#__em_action")?.value||"hover",success:!1,timestamp:Date.now(),matchCount:0},t=[...u.get("validationHistory")||[],o].slice(-5);u.set({validation:{status:"failure",message:`\u9519\u8BEF: ${e.message}`},validationHistory:t})}}async function ee({selector:e,selectorType:o="css",listMode:t=!1}){const n=String(e||"").trim();if(!n)return{success:!1,error:"selector is required"};try{if(n.includes("|>")){const d=n.split("|>").map(c=>c.trim()).filter(Boolean);if(d.length>=2){const c=d[0],m=d.slice(1).join(" |> ");let p=null;try{p=querySelectorDeepFirst(c)||document.querySelector(c)}catch{}if(!p||!(p instanceof HTMLIFrameElement||p instanceof HTMLFrameElement))return{success:!1,error:`Frame element not found: ${c}`};const f=p.contentWindow;return f?new Promise(g=>{const _=`em_highlight_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,v=O=>{try{const E=O?.data;if(!E||E.type!=="em-highlight-result"||E.reqId!==_)return;window.removeEventListener("message",v,!0),g(E.result)}catch{}};window.addEventListener("message",v,!0),setTimeout(()=>{window.removeEventListener("message",v,!0),g({success:!1,error:"Frame highlight timeout"})},3e3),f.postMessage({type:"em-highlight-request",reqId:_,selector:m,selectorType:o,listMode:t},"*")}):{success:!1,error:"Unable to access frame contentWindow"}}}const i=(t?"css":o)==="xpath"?R(n):T(n),a=H(i);if(!a||a.length===0)return{success:!1,error:"No elements found for selector"};const l=a[0];return l&&l.scrollIntoView({block:"center",inline:"center",behavior:"smooth"}),await D(150),C(a,h.COLORS.VERIFY,!1),setTimeout(()=>{I()},2e3),{success:!0,count:a.length}}catch(s){return{success:!1,error:s.message||String(s)}}}function te(){try{const e=r.box?.querySelector("#__em_selector")?.textContent?.trim();if(!e)return;navigator.clipboard?.writeText(e).catch(()=>{}),u.set({validation:{status:"success",message:"\u2713 \u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F"}}),setTimeout(()=>{u.set({validation:{status:"idle",message:""}})},2e3)}catch{}}async function ge(){try{const e=r.box?.querySelector("#__em_name")?.value?.trim(),o=r.box?.querySelector("#__em_selector")?.textContent?.trim();if(!o)return;const t=location.href;let n=u.get("selectorType");const s=u.get("listMode");s&&n==="xpath"&&(n="css"),await chrome.runtime.sendMessage({type:"element_marker_save",marker:{url:t,name:e||o,selector:o,selectorType:n,listMode:s}})}catch{}k()}function he(){if(!r.active){if(r.active=!0,L){const{host:e}=y.mount();r.box=e,u.init(),_e()}B(),U(),G(),ue(),Z()}}function k(){r.active=!1,W(),pe(),r.hoverRafId!=null&&(cancelAnimationFrame(r.hoverRafId),r.hoverRafId=null),M=null;try{r.highlighter?.remove(),r.rectsHost?.remove(),y.unmount(),P.destroy()}catch{}r.highlighter=null,r.rectsHost=null,r.box=null,r.hoveredList=[],r.hoverEl=null,r.selectedEl=null,r.lastHoverTarget=null,r.verifyRectsActive=!1,r.rectPool.length=0,r.rectPoolUsed=0}function _e(){const e=r.box;if(!e)return;e.querySelector("#__em_close")?.addEventListener("click",k),e.querySelector("#__em_cancel")?.addEventListener("click",k),e.querySelector("#__em_save")?.addEventListener("click",ge),e.querySelector("#__em_verify")?.addEventListener("click",fe),e.querySelector("#__em_execute")?.addEventListener("click",me),e.querySelector("#__em_copy")?.addEventListener("click",te),e.querySelector("#__em_copy_selector")?.addEventListener("click",te),e.querySelector("#__em_action")?.addEventListener("change",n=>{oe(n.target.value)}),e.querySelector("#__em_selector_type")?.addEventListener("change",n=>{const s=n.target.value,i=u.get("listMode");s==="xpath"&&i?u.set({selectorType:s,listMode:!1}):u.set({selectorType:s}),r.selectedEl&&x(r.selectedEl)}),e.querySelector("#__em_toggle_list")?.addEventListener("click",n=>{const i=!u.get("listMode");if(i){u.set({listMode:!0,selectorType:"css"});const l=e.querySelector("#__em_selector_type");l&&(l.value="css")}else u.set({listMode:!1});const a=n.currentTarget;a&&(i?a.classList.add("active"):a.classList.remove("active")),r.selectedEl&&x(r.selectedEl),$()}),e.querySelector("#__em_toggle_tab")?.addEventListener("click",()=>{const n=u.get("activeTab");u.set({activeTab:n==="attributes"?"execute":"attributes"})}),e.querySelectorAll(".em-tab").forEach(n=>{n.addEventListener("click",()=>{u.set({activeTab:n.dataset.tab})})}),e.querySelector("#__em_nav_up")?.addEventListener("click",()=>{const n=r.selectedEl||r.hoverEl;n?.parentElement&&x(n.parentElement)}),e.querySelector("#__em_nav_down")?.addEventListener("click",()=>{const n=r.selectedEl||r.hoverEl;n?.firstElementChild&&x(n.firstElementChild)}),e.querySelector("#__em_pref_id")?.addEventListener("change",n=>{const s={...u.get("prefs"),preferId:!!n.target.checked};u.set({prefs:s})}),e.querySelector("#__em_pref_attr")?.addEventListener("change",n=>{const s={...u.get("prefs"),preferStableAttr:!!n.target.checked};u.set({prefs:s})}),e.querySelector("#__em_pref_class")?.addEventListener("change",n=>{const s={...u.get("prefs"),preferClass:!!n.target.checked};u.set({prefs:s})});const t=e.querySelector("#__em_drag_handle");t&&P.init(t),be()}function oe(e){const o=r.box;if(!o)return;const t=o.querySelector("#__em_action_text_group"),n=o.querySelector("#__em_action_keys_group"),s=o.querySelector("#__em_scroll_options"),i=o.querySelector("#__em_click_options");if(t&&(t.style.display="none"),n&&(n.style.display="none"),s&&(s.style.display="none"),i&&(i.style.display="none"),e==="type_text")t&&(t.style.display="block");else if(e==="press_keys")n&&(n.style.display="block");else if(e==="scroll")s&&(s.style.display="block");else if(["left_click","double_click","right_click"].includes(e)){i&&(i.style.display="block");const a=o.querySelector("#__em_btn")?.closest(".em-field");a&&(a.style.display=e==="right_click"?"none":"block")}}function be(){const e=r.box;if(!e)return;const o=u.get(),t=e.querySelector("#__em_selector_type");t&&(t.value=o.selectorType);const n=e.querySelector("#__em_toggle_list");n&&(o.listMode?n.classList.add("active"):n.classList.remove("active"));const s=e.querySelector("#__em_pref_id"),i=e.querySelector("#__em_pref_attr"),a=e.querySelector("#__em_pref_class");s&&(s.checked=o.prefs.preferId),i&&(i.checked=o.prefs.preferStableAttr),a&&(a.checked=o.prefs.preferClass);const l=e.querySelector("#__em_action");l&&oe(l.value)}window.addEventListener("message",e=>{try{const o=e?.data;if(!o)return;if(o.type==="em-highlight-request"){ee({selector:o.selector,selectorType:o.selectorType||"css",listMode:!!o.listMode}).then(i=>{window.parent.postMessage({type:"em-highlight-result",reqId:o.reqId,result:i},"*")}).catch(i=>{window.parent.postMessage({type:"em-highlight-result",reqId:o.reqId,result:{success:!1,error:i?.message||String(i)}},"*")});return}if(!r.active||!L)return;const n=Array.from(document.querySelectorAll("iframe")).find(i=>{try{return i.contentWindow===e.source}catch{return!1}});if(!n)return;const s=n.getBoundingClientRect();if(o.type==="em_hover"&&Array.isArray(o.rects))Y(o.rects,{offsetX:s.left,offsetY:s.top,color:h.COLORS.HOVER,dashed:!0});else if(o.type==="em_click"&&o.innerSel){const i=S(n),a=i?`${i} |> ${o.innerSel}`:o.innerSel,l=r.box?.querySelector("#__em_selector"),d=r.box?.querySelector("#__em_selector_text");l&&(l.textContent=a),d&&(d.textContent=a)}}catch{}},!0),chrome.runtime.onMessage.addListener((e,o,t)=>e?.action==="element_marker_start"?(he(),t({ok:!0}),!0):e?.action==="element_marker_ping"?(t({status:"pong"}),!1):e?.action==="element_marker_highlight"?(ee({selector:e.selector,selectorType:e.selectorType,listMode:!!e.listMode}).then(n=>t(n)).catch(n=>t({success:!1,error:n?.message||String(n)})),!0):!1)})();
