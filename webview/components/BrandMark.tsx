/**
 * Inline XPlain letter — same geometry as media/xplain.svg (generated from the logo in
 * assets/social-logo.png): bold X whose top-right arm is a microscope, side chevrons and
 * the explanation card. `mask` = silhouette in currentColor (header, chips); `detail` =
 * outlined version with dark fills for the Result empty state.
 */
export function BrandMark(props: { class?: string; size?: number; title?: string; variant?: 'mask' | 'detail' }) {
  const size = props.size ?? 16;
  const detail = props.variant === 'detail';
  return (
    <svg
      class={`brand-mark ${props.class ?? ''}`}
      width={size}
      height={size}
      viewBox="0 -124 1024 1024"
      aria-hidden={props.title ? undefined : true}
      role={props.title ? 'img' : undefined}
    >
      {props.title && <title>{props.title}</title>}
      {detail ? (
        <>
          <g filter="none" fill="var(--xp-card-fill, #0b0f17)" stroke="currentColor" stroke-width="16" stroke-linejoin="round" stroke-linecap="round">
          <path d="M128 118L318 118L469.3 357.5L427.5 357.5Z"/>
          <path d="M128 727L318 727L469.3 491.4L427.5 491.4Z"/>
          <path d="M706 727L896 727L596.5 491.4L554.7 491.4Z"/>
          <g fill="none" stroke-width="5" opacity="0.8">
          <path d="M272 127L327 185L326 227L381 285"/>
          <path d="M239 186L314 266L353 270"/>
          <path d="M423 273L380 314"/>
          <path d="M229 677L284 620L327 619L382 561"/>
          <path d="M290 708L366 628L369 589"/>
          <path d="M367 519L410 560"/>
          <path d="M752 719L696 661L697 619L642 561"/>
          <path d="M785 659L709 580L670 576"/>
          <path d="M599 574L643 533"/>
          </g>
          <g stroke="none" fill="currentColor" opacity="0.9">
          <rect x="264" y="119" width="16" height="16" rx="3"/>
          <rect x="231" y="178" width="16" height="16" rx="3"/>
          <rect x="373" y="277" width="16" height="16" rx="3"/>
          <rect x="345" y="262" width="16" height="16" rx="3"/>
          <rect x="282" y="182" width="32" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="5"/>
          <rect x="291" y="191" width="14" height="14" rx="2"/>
          <rect x="221" y="669" width="16" height="16" rx="3"/>
          <rect x="282" y="700" width="16" height="16" rx="3"/>
          <rect x="374" y="553" width="16" height="16" rx="3"/>
          <rect x="361" y="581" width="16" height="16" rx="3"/>
          <rect x="283" y="632" width="32" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="5"/>
          <rect x="292" y="641" width="14" height="14" rx="2"/>
          <rect x="744" y="711" width="16" height="16" rx="3"/>
          <rect x="777" y="651" width="16" height="16" rx="3"/>
          <rect x="634" y="553" width="16" height="16" rx="3"/>
          <rect x="662" y="568" width="16" height="16" rx="3"/>
          <rect x="709" y="632" width="32" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="5"/>
          <rect x="718" y="641" width="14" height="14" rx="2"/>
          </g>
          <path d="M746 300V392q0 42 -36 42H704" fill="none" stroke-width="48"/>
          <path d="M746 300V392q0 42 -36 42H704" fill="none" stroke="var(--xp-card-fill, #0b0f17)" stroke-width="20"/>
          <g transform="translate(588 302) rotate(-48.14)">
          <rect x="0.0" y="-36" width="60.0" height="72" rx="10"/>
          <rect x="56.0" y="-54" width="160.0" height="108" rx="20"/>
          <rect x="210.0" y="-66" width="44.0" height="132" rx="10"/>
          <rect x="248.0" y="-56" width="83.7" height="112" rx="22"/>
          <rect x="301.7" y="-64" width="34.0" height="128" rx="10"/>
          </g>
          <circle cx="746" cy="246" r="50"/>
          <circle cx="746" cy="246" r="26"/>
          <rect x="500" y="280" width="24" height="20" rx="4" stroke-width="10"/>
          <rect x="500" y="550" width="24" height="20" rx="4" stroke-width="10"/>
          <rect x="314" y="414" width="20" height="24" rx="4" stroke-width="10"/>
          <rect x="690" y="414" width="20" height="24" rx="4" stroke-width="10"/>
          <rect x="330" y="298" width="364" height="254" rx="70"/>
          <g stroke="none" fill="currentColor">
          <circle cx="405" cy="372" r="10"/>
          <rect x="432" y="362" width="160" height="20" rx="10"/>
          <circle cx="405" cy="411" r="10"/>
          <rect x="432" y="401" width="128" height="20" rx="10"/>
          <circle cx="405" cy="449" r="10"/>
          <rect x="432" y="439" width="154" height="20" rx="10"/>
          <circle cx="405" cy="487" r="10"/>
          <rect x="432" y="477" width="113" height="20" rx="10"/>
          </g>
          <path d="M240 300L82 435L240 568" fill="none" stroke-width="74"/>
          <path d="M240 300L82 435L240 568" fill="none" stroke="var(--xp-card-fill, #0b0f17)" stroke-width="40"/>
          <path d="M784 300L942 435L784 568" fill="none" stroke-width="74"/>
          <path d="M784 300L942 435L784 568" fill="none" stroke="var(--xp-card-fill, #0b0f17)" stroke-width="40"/>
          </g>
        </>
      ) : (
        <>
          <defs><mask id="card-hole"><rect width="1024" height="775" fill="#fff"/><rect x="330" y="298" width="364" height="254" rx="70" fill="#000"/></mask></defs>
          <g mask="url(#xp-card-hole)" fill="currentColor" stroke="currentColor" stroke-linejoin="round" stroke-linecap="round" stroke-width="0">
          <path d="M128 118L318 118L469.3 357.5L427.5 357.5Z"/>
          <path d="M128 727L318 727L469.3 491.4L427.5 491.4Z"/>
          <path d="M706 727L896 727L596.5 491.4L554.7 491.4Z"/>
          <path d="M746 300V392q0 42 -36 42H704" fill="none" stroke-width="48"/>
          <g transform="translate(588 302) rotate(-48.14)">
          <rect x="0.0" y="-36" width="60.0" height="72" rx="10"/>
          <rect x="56.0" y="-54" width="160.0" height="108" rx="20"/>
          <rect x="210.0" y="-66" width="44.0" height="132" rx="10"/>
          <rect x="248.0" y="-56" width="83.7" height="112" rx="22"/>
          <rect x="301.7" y="-64" width="34.0" height="128" rx="10"/>
          </g>
          <circle cx="746" cy="246" r="50"/>
          <path d="M240 300L82 435L240 568" fill="none" stroke-width="74"/>
          <path d="M784 300L942 435L784 568" fill="none" stroke-width="74"/>
          </g>
          <rect x="301.6724594005293" y="298" width="364" height="254" rx="70" fill="none" stroke="currentColor" stroke-width="40"/>
          <g fill="currentColor">
          <circle cx="405" cy="372" r="14"/>
          <rect x="432" y="358" width="160" height="28" rx="14"/>
          <circle cx="405" cy="411" r="14"/>
          <rect x="432" y="397" width="128" height="28" rx="14"/>
          <circle cx="405" cy="449" r="14"/>
          <rect x="432" y="435" width="154" height="28" rx="14"/>
          <circle cx="405" cy="487" r="14"/>
          <rect x="432" y="473" width="113" height="28" rx="14"/>
          </g>
        </>
      )}
    </svg>
  );
}
