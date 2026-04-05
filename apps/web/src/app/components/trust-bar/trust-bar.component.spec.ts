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

/** Build a TrustMetadata object with sensible defaults and overrides. */
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

/** Query all indicator spans (role="group" children). */
function getIndicators(el: HTMLElement): HTMLElement[] {
  const group = el.querySelector('[role="group"]');
  if (!group) return [];
  return Array.from(group.querySelectorAll(':scope > span'));
}

/** Get all indicator text content joined. */
function getAllText(el: HTMLElement): string {
  const group = el.querySelector('[role="group"]');
  return group?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
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

  it('should render 4 indicators when showHnCount > 0', () => {
    createHost(stubTrust({ showHnCount: 2 }));
    expect(getIndicators(el).length).toBe(4);
  });

  it('should render 3 indicators when showHnCount is 0', () => {
    createHost(stubTrust({ showHnCount: 0 }));
    expect(getIndicators(el).length).toBe(3);
  });

  // ── Labels ──

  it('should show "All N sources verified" when all verified', () => {
    createHost(stubTrust({ sourcesVerified: 4, sourcesTotal: 4 }));
    expect(getAllText(el)).toContain('All 4 sources verified');
  });

  it('should show "X of Y verified" when partially verified', () => {
    createHost(stubTrust({ sourcesVerified: 3, sourcesTotal: 5 }));
    expect(getAllText(el)).toContain('3 of 5 verified');
  });

  it('should show "Mostly recent sources" for high recency', () => {
    createHost(stubTrust({ recentSourceRatio: 0.8 }));
    expect(getAllText(el)).toContain('Mostly recent sources');
  });

  it('should show "Age unknown" when no date data', () => {
    createHost(stubTrust({ recentSourceRatio: 0, avgSourceAge: 0 }));
    expect(getAllText(el)).toContain('Age unknown');
  });

  it('should show "Multiple viewpoints" for balanced', () => {
    createHost(stubTrust({ viewpointDiversity: 'balanced' }));
    expect(getAllText(el)).toContain('Multiple viewpoints');
  });

  it('should show "Actively debated" for contested', () => {
    createHost(stubTrust({ viewpointDiversity: 'contested' }));
    expect(getAllText(el)).toContain('Actively debated');
  });

  it('should show "One-sided perspective" for one-sided', () => {
    createHost(stubTrust({ viewpointDiversity: 'one-sided' }));
    expect(getAllText(el)).toContain('One-sided perspective');
  });

  it('should show Show HN warning with count', () => {
    createHost(stubTrust({ showHnCount: 3 }));
    expect(getAllText(el)).toContain('3 Show HN posts (may be biased)');
  });

  // ── Recency label branches ──

  it('should show "Mix of old and new" for recentSourceRatio ~0.6', () => {
    createHost(stubTrust({ recentSourceRatio: 0.6 }));
    expect(getAllText(el)).toContain('Mix of old and new');
  });

  it('should show "Mostly older sources" for recentSourceRatio ~0.3', () => {
    createHost(stubTrust({ recentSourceRatio: 0.3 }));
    expect(getAllText(el)).toContain('Mostly older');
  });

  it('should show avg age fallback when recentSourceRatio is 0 but avgSourceAge > 0', () => {
    createHost(stubTrust({ recentSourceRatio: 0, avgSourceAge: 45 }));
    expect(getAllText(el)).toContain('45 days old');
  });

  // ── Colors ──

  it('should use verified color when all verified', () => {
    createHost(stubTrust({ sourcesVerified: 4, sourcesTotal: 4 }));
    const first = getIndicators(el)[0];
    expect(first.className).toContain('text-trust-verified');
  });

  it('should use caution color when partially verified', () => {
    createHost(stubTrust({ sourcesVerified: 2, sourcesTotal: 4 }));
    const first = getIndicators(el)[0];
    expect(first.className).toContain('text-trust-caution');
  });

  it('should use muted color when no sources', () => {
    createHost(stubTrust({ sourcesVerified: 0, sourcesTotal: 0 }));
    const first = getIndicators(el)[0];
    expect(first.className).toContain('text-text-muted');
  });

  it('should use amber color for recency when ratio ~0.6', () => {
    createHost(stubTrust({ recentSourceRatio: 0.6 }));
    const recencyIndicator = getIndicators(el)[1];
    expect(recencyIndicator.className).toContain('text-accent-amber');
  });

  it('should use caution color for recency when ratio ~0.3', () => {
    createHost(stubTrust({ recentSourceRatio: 0.3 }));
    const recencyIndicator = getIndicators(el)[1];
    expect(recencyIndicator.className).toContain('text-trust-caution');
  });

  // ── Honesty flags ──

  it('should show honesty flags as italic note', () => {
    createHost(stubTrust({ honestyFlags: ['old_sources_noted'] }));
    const note = el.querySelector('.italic');
    expect(note?.textContent).toContain('old sources noted');
  });

  it('should not render honesty flags when empty', () => {
    createHost(stubTrust({ honestyFlags: [] }));
    expect(el.querySelector('.italic')).toBeNull();
  });

  // ── Accessibility ──

  it('should have SVGs marked as aria-hidden', () => {
    createHost(stubTrust());
    const svgs = el.querySelectorAll('svg');
    svgs.forEach((svg) => {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('should have role group with label', () => {
    createHost(stubTrust());
    const group = el.querySelector('[role="group"]');
    expect(group?.getAttribute('aria-label')).toBe('Trust indicators');
  });
});
