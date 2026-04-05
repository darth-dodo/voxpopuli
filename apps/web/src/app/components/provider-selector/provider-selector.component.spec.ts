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
    expect(names).toEqual(['Groq', 'Mistral', 'Claude']);
  });

  it('should show speed and cost for the selected provider', () => {
    const label = fixture.nativeElement.querySelector('p');
    expect(label.textContent).toContain('Fastest');
    expect(label.textContent).toContain('Free tier');
  });

  // ---------------------------------------------------------------------------
  // Active state
  // ---------------------------------------------------------------------------

  it('should apply active class to the default selected chip', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    expect(buttons[0].classList.contains('vp-chip--active')).toBe(true);
    expect(buttons[1].classList.contains('vp-chip--active')).toBe(false);
    expect(buttons[2].classList.contains('vp-chip--active')).toBe(false);
  });

  it('should set aria-checked correctly for the default selection', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    expect(buttons[0].getAttribute('aria-checked')).toBe('true');
    expect(buttons[1].getAttribute('aria-checked')).toBe('false');
  });

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  it('should change selection when a chip is clicked', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    buttons[1].click();
    fixture.detectChanges();

    expect(component.selectedProvider()).toBe('mistral');
    expect(buttons[1].classList.contains('vp-chip--active')).toBe(true);
    expect(buttons[0].classList.contains('vp-chip--active')).toBe(false);
  });

  it('should update speed/cost label when selection changes', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    buttons[2].click();
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector('p');
    expect(label.textContent).toContain('Slower');
    expect(label.textContent).toContain('Higher');
  });

  it('should update aria-checked when selection changes', () => {
    const buttons = fixture.nativeElement.querySelectorAll('button[role="radio"]');
    buttons[2].click();
    fixture.detectChanges();

    expect(buttons[2].getAttribute('aria-checked')).toBe('true');
    expect(buttons[0].getAttribute('aria-checked')).toBe('false');
  });
});
