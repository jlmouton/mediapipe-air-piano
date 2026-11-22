/**
 * Dual-Hand Air Synth Demo — Framework UI Controls (Precision SVG RotaryKnob)
 */
(function (root) {
  'use strict';

  class RotaryKnob {
    constructor(element, min, max, initialVal, step, unit, onChange, customFormatter) {
      this.el = element;
      this.min = min;
      this.max = max;
      this.val = initialVal;
      this.defaultVal = initialVal;
      this.step = step || 1;
      this.unit = unit || '';
      this.onChange = onChange;
      this.customFormatter = customFormatter;
      this.isDragging = false;
      this.startY = 0;
      this.startVal = initialVal;

      this.dialProgress = this.el ? this.el.querySelector('.knob-progress') : null;
      this.valBadge = this.el ? this.el.querySelector('.knob-val') : null;

      if (this.el) {
        this.initEvents();
        this.updateDisplay();
      }
    }

    initEvents() {
      this.el.addEventListener('mousedown', (e) => {
        this.isDragging = true;
        this.startY = e.clientY;
        this.startVal = this.val;
        if (typeof document !== 'undefined' && document.body) {
          document.body.style.cursor = 'ns-resize';
        }
      });

      if (typeof window !== 'undefined') {
        window.addEventListener('mousemove', (e) => {
          if (!this.isDragging) return;
          const dy = this.startY - e.clientY;
          const sensitivity = e.shiftKey ? 0.001 : 0.005;
          const delta = dy * (this.max - this.min) * sensitivity;
          this.setValue(this.startVal + delta);
        });

        window.addEventListener('mouseup', () => {
          if (this.isDragging) {
            this.isDragging = false;
            if (typeof document !== 'undefined' && document.body) {
              document.body.style.cursor = 'default';
            }
          }
        });
      }

      this.el.addEventListener('dblclick', () => {
        if (typeof prompt === 'function') {
          const input = prompt(`Enter value (${this.min} - ${this.max} ${this.unit}):`, this.val);
          if (input !== null) {
            const num = parseFloat(input);
            if (!isNaN(num)) this.setValue(num);
          }
        }
      });

      this.el.addEventListener('click', (e) => {
        if (e.altKey) {
          this.setValue(this.defaultVal);
        }
      });

      this.el.addEventListener('wheel', (e) => {
        if (e.preventDefault) e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        this.setValue(Number((this.val + dir * this.step).toFixed(4)));
      });
    }

    setValue(newVal, triggerChange = true) {
      this.val = Math.max(this.min, Math.min(this.max, newVal));
      if (this.step >= 1) {
        this.val = Math.round(this.val / this.step) * this.step;
      }
      this.updateDisplay();
      if (triggerChange && this.onChange) {
        this.onChange(this.val);
      }
    }

    updateDisplay() {
      const norm = (this.val - this.min) / (this.max - this.min);
      const circumference = 125.6; // 2 * PI * 20
      const offset = circumference * (1.0 - norm * 0.75);

      if (this.dialProgress) {
        this.dialProgress.style.strokeDashoffset = offset;
      }
      if (this.valBadge) {
        if (this.customFormatter) {
          this.valBadge.innerText = this.customFormatter(this.val);
        } else {
          let displayVal;
          if (this.step < 0.01) {
            displayVal = this.val.toFixed(3);
          } else if (this.step < 0.1) {
            displayVal = this.val.toFixed(2);
          } else if (this.step < 1) {
            displayVal = this.val.toFixed(1);
          } else {
            displayVal = Math.round(this.val);
          }
          this.valBadge.innerText = `${displayVal}${this.unit}`;
        }
      }
    }

    static bind(id, min, max, initialVal, step, unit, onChange, customFormatter) {
      if (typeof document === 'undefined') return null;
      const el = document.getElementById(id);
      if (!el) return null;
      return new RotaryKnob(el, min, max, initialVal, step, unit, onChange, customFormatter);
    }
  }

  root.RotaryKnob = RotaryKnob;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { RotaryKnob };
  }
})(typeof window !== 'undefined' ? window : globalThis);
