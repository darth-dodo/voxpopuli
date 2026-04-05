import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, input } from '@angular/core';
import type { AgentSource } from '@voxpopuli/shared-types';
import { SourceCardComponent } from './source-card.component';

// ---------------------------------------------------------------------------
// Test host — wraps SourceCardComponent so we can feed signal inputs
// ---------------------------------------------------------------------------

@Component({
  standalone: true,
  imports: [SourceCardComponent],
  template: `<vp-source-card [source]="source()" />`,
})
class TestHostComponent {
  readonly source = input.required<AgentSource>();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubSource(overrides: Partial<AgentSource> = {}): AgentSource {
  return {
    storyId: 39482731,
    title: 'Tailwind v4: 5x Faster with Oxide',
    url: 'https://tailwindcss.com/blog/v4',
    author: 'swyx',
    points: 340,
    commentCount: 89,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SourceCardComponent', () => {
  let fixture: ComponentFixture<TestHostComponent>;
  let el: HTMLElement;

  function createHost(source: AgentSource): void {
    fixture = TestBed.createComponent(TestHostComponent);
    fixture.componentRef.setInput('source', source);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TestHostComponent],
    }).compileComponents();
  });

  it('should render the story title', () => {
    createHost(stubSource());
    const title = el.querySelector('.vp-source-card__title');
    expect(title?.textContent).toContain('Tailwind v4: 5x Faster with Oxide');
  });

  it('should render author, points, and comment count', () => {
    createHost(stubSource());
    const meta = el.querySelector('.vp-source-card__meta');
    expect(meta?.textContent).toContain('swyx');
    expect(meta?.textContent).toContain('340 pts');
    expect(meta?.textContent).toContain('89 comments');
  });

  it('should generate the correct HN discussion link from storyId', () => {
    createHost(stubSource({ storyId: 12345 }));
    const cardLink = el.querySelector('a.vp-source-card') as HTMLAnchorElement;
    expect(cardLink.href).toBe('https://news.ycombinator.com/item?id=12345');
  });

  it('should link the title to the original URL when present', () => {
    createHost(stubSource({ url: 'https://example.com/article' }));
    const titleLink = el.querySelector('.vp-source-card__title a') as HTMLAnchorElement;
    expect(titleLink).toBeTruthy();
    expect(titleLink.href).toBe('https://example.com/article');
    expect(titleLink.target).toBe('_blank');
    expect(titleLink.rel).toContain('noopener');
  });

  it('should render title as plain text when url is empty', () => {
    createHost(stubSource({ url: '' }));
    const titleLink = el.querySelector('.vp-source-card__title a');
    expect(titleLink).toBeNull();
    const titleEl = el.querySelector('.vp-source-card__title');
    expect(titleEl?.textContent).toContain('Tailwind v4: 5x Faster with Oxide');
  });

  it('should open the HN discussion link in a new tab', () => {
    createHost(stubSource());
    const cardLink = el.querySelector('a.vp-source-card') as HTMLAnchorElement;
    expect(cardLink.target).toBe('_blank');
    expect(cardLink.rel).toContain('noopener');
    expect(cardLink.rel).toContain('noreferrer');
  });

  it('should have accessible aria-label on the card link', () => {
    createHost(stubSource({ title: 'Test Title' }));
    const cardLink = el.querySelector('a.vp-source-card') as HTMLAnchorElement;
    expect(cardLink.getAttribute('aria-label')).toBe('View HN discussion: Test Title');
  });
});
