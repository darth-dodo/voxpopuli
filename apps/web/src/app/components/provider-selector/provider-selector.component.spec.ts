import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProviderSelectorComponent } from './provider-selector.component';

describe('ProviderSelectorComponent', () => {
  let fixture: ComponentFixture<ProviderSelectorComponent>;
  let component: ProviderSelectorComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProviderSelectorComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ProviderSelectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  it('should render 3 provider chips', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    expect(buttons.length).toBe(3);
  });

  it('should display provider names', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    const names = Array.from(buttons).map((b) => (b as HTMLElement).textContent?.trim());
    expect(names).toEqual(['Qwen3', 'Mistral', 'Claude']);
  });

  it('should expose activeProvider computed for the selected provider', () => {
    expect(component.activeProvider().speed).toBe('Moderate');
    expect(component.activeProvider().cost).toBe('Low');
  });

  // ---------------------------------------------------------------------------
  // Active state
  // ---------------------------------------------------------------------------

  it('should apply active class to the default selected chip (Mistral)', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    expect(buttons[0].classList.contains('vp-chip--active')).toBe(false);
    expect(buttons[1].classList.contains('vp-chip--active')).toBe(true);
    expect(buttons[2].classList.contains('vp-chip--active')).toBe(false);
  });

  it('should set aria-checked correctly for the default selection', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    expect(buttons[0].getAttribute('aria-checked')).toBe('false');
    expect(buttons[1].getAttribute('aria-checked')).toBe('true');
  });

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  it('should change selection when a chip is clicked', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    buttons[0].click();
    fixture.detectChanges();

    expect(component.selectedProvider()).toBe('groq');
    expect(buttons[0].classList.contains('vp-chip--active')).toBe(true);
    expect(buttons[1].classList.contains('vp-chip--active')).toBe(false);
  });

  it('should update activeProvider when selection changes', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    buttons[2].click();
    fixture.detectChanges();

    expect(component.activeProvider().speed).toBe('Slower');
    expect(component.activeProvider().cost).toBe('Higher');
  });

  it('should update aria-checked when selection changes', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    buttons[2].click();
    fixture.detectChanges();

    expect(buttons[2].getAttribute('aria-checked')).toBe('true');
    expect(buttons[0].getAttribute('aria-checked')).toBe('false');
  });
});
