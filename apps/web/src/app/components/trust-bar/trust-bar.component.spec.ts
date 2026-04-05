import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input } from '@angular/core';
import type { TrustMetadata } from '@voxpopuli/shared-types';
import { TrustBarComponent } from './trust-bar.component';

// ---------------------------------------------------------------------------
// Test host
// ---------------------------------------------------------------------------

@Component({
  standalone: true,
  imports: [TrustBarComponent],
  template: `<app-trust-bar [trust]="trust()" />`,
})
class TestHostComponent {
  readonly trust = input.required<TrustMetadata>();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubTrust(overrides: Partial<TrustMetadata> = {}): TrustMetadata {
  return {
    sourcesVerified: 4,
    sourcesTotal: 4,
    avgSourceAge: 30,
    recentSourceRatio: 0.75,
    viewpointDiversity: 'balanced',
    showHnCount: 1,
    honestyFlags: [],
    ...overrides,
  };
}

/** Query all `.vp-trust-indicator` elements as an array. */
function getIndicators(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll('.vp-trust-indicator'));
}

/** Get combined text content of all indicators. */
function getIndicatorTexts(el: HTMLElement): string {
  return getIndicators(el)
    .map((ind) => ind.textContent?.trim() ?? '')
    .join(' | ');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TrustBarComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let el: HTMLElement;

  function createHost(trust: TrustMetadata): void {
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentRef.setInput('trust', trust);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();
  });

  // ── Indicator rendering ──

  it('should render all 4 indicators when showHnCount > 0', () => {
    createHost(stubTrust({ showHnCount: 2 }));
    const indicators = getIndicators(el);
    expect(indicators.length).toBe(4);
  });

  it('should render 3 indicators when showHnCount is 0', () => {
    createHost(stubTrust({ showHnCount: 0 }));
    const indicators = getIndicators(el);
    expect(indicators.length).toBe(3);
  });

  it('should display verified count label', () => {
    createHost(stubTrust({ sourcesVerified: 3, sourcesTotal: 5 }));
    expect(getIndicatorTexts(el)).toContain('3/5 verified');
  });

  it('should display recency as percentage', () => {
    createHost(stubTrust({ recentSourceRatio: 0.8 }));
    expect(getIndicatorTexts(el)).toContain('80% recent');
  });

  it('should display viewpoint diversity label', () => {
    createHost(stubTrust({ viewpointDiversity: 'contested' }));
    expect(getIndicatorTexts(el)).toContain('contested');
  });

  it('should display Show HN count', () => {
    createHost(stubTrust({ showHnCount: 3 }));
    expect(getIndicatorTexts(el)).toContain('3 Show HN');
  });

  // ── Color logic ──

  it('should use verified color when all sources are verified', () => {
    createHost(stubTrust({ sourcesVerified: 4, sourcesTotal: 4 }));
    const verifiedSpan = getIndicators(el)[0].querySelector('span');
    expect(verifiedSpan?.classList.contains('text-trust-verified')).toBe(true);
  });

  it('should use caution color when not all sources are verified', () => {
    createHost(stubTrust({ sourcesVerified: 2, sourcesTotal: 4 }));
    const verifiedSpan = getIndicators(el)[0].querySelector('span');
    expect(verifiedSpan?.classList.contains('text-trust-caution')).toBe(true);
  });

  it('should use verified color for recency > 75%', () => {
    createHost(stubTrust({ recentSourceRatio: 0.9 }));
    const recencySpan = getIndicators(el)[1].querySelector('span');
    expect(recencySpan?.classList.contains('text-trust-verified')).toBe(true);
  });

  it('should use caution color for recency between 50-75%', () => {
    createHost(stubTrust({ recentSourceRatio: 0.6 }));
    const recencySpan = getIndicators(el)[1].querySelector('span');
    expect(recencySpan?.classList.contains('text-trust-caution')).toBe(true);
  });

  it('should use warning color for recency below 50%', () => {
    createHost(stubTrust({ recentSourceRatio: 0.3 }));
    const recencySpan = getIndicators(el)[1].querySelector('span');
    expect(recencySpan?.classList.contains('text-trust-warning')).toBe(true);
  });

  it('should use blue color for contested viewpoints', () => {
    createHost(stubTrust({ viewpointDiversity: 'contested' }));
    const diversitySpan = getIndicators(el)[2].querySelector('span');
    expect(diversitySpan?.classList.contains('text-accent-blue')).toBe(true);
  });

  it('should use verified color for balanced viewpoints', () => {
    createHost(stubTrust({ viewpointDiversity: 'balanced' }));
    const diversitySpan = getIndicators(el)[2].querySelector('span');
    expect(diversitySpan?.classList.contains('text-trust-verified')).toBe(true);
  });

  it('should use caution color for one-sided viewpoints', () => {
    createHost(stubTrust({ viewpointDiversity: 'one-sided' }));
    const diversitySpan = getIndicators(el)[2].querySelector('span');
    expect(diversitySpan?.classList.contains('text-trust-caution')).toBe(true);
  });

  // ── Honesty flags ──

  it('should show honesty flags when present', () => {
    createHost(stubTrust({ honestyFlags: ['old_sources_noted', 'no_results_found'] }));
    const flags = el.querySelectorAll('.text-text-muted');
    const flagTexts = Array.from(flags).map((f) => f.textContent?.trim());
    expect(flagTexts).toContain('old sources noted');
    expect(flagTexts).toContain('no results found');
  });

  it('should not render honesty flags section when empty', () => {
    createHost(stubTrust({ honestyFlags: [] }));
    // No extra muted spans should exist outside the indicators
    const flagContainer = el.querySelector('.mt-2');
    expect(flagContainer).toBeNull();
  });

  // ── Accessibility ──

  it('should have SVG icons marked as aria-hidden', () => {
    createHost(stubTrust());
    const svgs = el.querySelectorAll('svg');
    svgs.forEach((svg) => {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('should have a role group with aria-label on the indicator row', () => {
    createHost(stubTrust());
    const group = el.querySelector('[role="group"]');
    expect(group).toBeTruthy();
    expect(group?.getAttribute('aria-label')).toBe('Trust indicators');
  });
});
