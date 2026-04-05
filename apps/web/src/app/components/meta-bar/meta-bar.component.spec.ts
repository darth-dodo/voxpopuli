import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import type { AgentMeta } from '@voxpopuli/shared-types';
import { MetaBarComponent } from './meta-bar.component';

// ---------------------------------------------------------------------------
// Test host — required because `input.required` cannot be set directly
// ---------------------------------------------------------------------------

@Component({
  standalone: true,
  imports: [MetaBarComponent],
  template: '<app-meta-bar [meta]="meta()" />',
})
class TestHostComponent {
  meta = signal<AgentMeta>(stubMeta());
}

/** Minimal AgentMeta factory. */
function stubMeta(overrides: Partial<AgentMeta> = {}): AgentMeta {
  return {
    provider: 'groq',
    totalInputTokens: 1000,
    totalOutputTokens: 234,
    durationMs: 4521,
    cached: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetaBarComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let host: TestHostComponent;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(TestHostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
    el = fixture.nativeElement.querySelector('app-meta-bar')!;
  });

  // ---------------------------------------------------------------------------
  // Basic rendering
  // ---------------------------------------------------------------------------

  it('should create', () => {
    expect(el).toBeTruthy();
  });

  it('should display the provider name', () => {
    expect(el.textContent).toContain('groq');
  });

  it('should display total token count', () => {
    // 1000 + 234 = 1,234
    expect(el.textContent).toContain('1,234 tokens');
  });

  it('should display latency in milliseconds', () => {
    expect(el.textContent).toContain('4,521ms');
  });

  // ---------------------------------------------------------------------------
  // Cached badge
  // ---------------------------------------------------------------------------

  it('should not show cached badge when cached is false', () => {
    expect(el.textContent).not.toContain('cached');
  });

  it('should show cached badge when cached is true', () => {
    host.meta.set(stubMeta({ cached: true }));
    fixture.detectChanges();
    expect(el.textContent).toContain('cached');

    const badge = el.querySelector('.vp-badge--cached');
    expect(badge).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Latency color thresholds
  // ---------------------------------------------------------------------------

  it('should apply green color class for latency < 5000ms', () => {
    host.meta.set(stubMeta({ durationMs: 2000 }));
    fixture.detectChanges();

    const latencySpan = findLatencySpan();
    expect(latencySpan?.classList.contains('text-trust-verified')).toBe(true);
  });

  it('should apply amber color class for latency between 5000ms and 15000ms', () => {
    host.meta.set(stubMeta({ durationMs: 10000 }));
    fixture.detectChanges();

    const latencySpan = findLatencySpan();
    expect(latencySpan?.classList.contains('text-accent-amber')).toBe(true);
  });

  it('should apply red color class for latency > 15000ms', () => {
    host.meta.set(stubMeta({ durationMs: 20000 }));
    fixture.detectChanges();

    const latencySpan = findLatencySpan();
    expect(latencySpan?.classList.contains('text-trust-danger')).toBe(true);
  });

  it('should apply amber at the 5000ms boundary', () => {
    host.meta.set(stubMeta({ durationMs: 5000 }));
    fixture.detectChanges();

    const latencySpan = findLatencySpan();
    expect(latencySpan?.classList.contains('text-accent-amber')).toBe(true);
  });

  it('should apply red at the 15001ms boundary', () => {
    host.meta.set(stubMeta({ durationMs: 15001 }));
    fixture.detectChanges();

    const latencySpan = findLatencySpan();
    expect(latencySpan?.classList.contains('text-trust-danger')).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Find the span that contains the latency value (ends with "ms"). */
  function findLatencySpan(): Element | null {
    const spans = el.querySelectorAll('span');
    return Array.from(spans).find((s) => s.textContent?.trim().endsWith('ms')) ?? null;
  }
});
