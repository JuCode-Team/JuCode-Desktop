"""Filled variants of lucide icons (src/lib/icons/filled.ts), shown by
ActiveIcon when an item is selected. Each is derived from the lucide geometry:
the outer shape is filled and inner details are knocked out through a mask
(`MASK` becomes a per-instance id). Icons that are only lines (menu, code,
terminal, git-branch, wrench, plugs, brain) have no filled variant; ActiveIcon
gives them a heavier stroke instead.

To add one, copy its markup from node_modules/@lucide/svelte/dist/icons/<name>.svelte
into SPEC as (name, outline, filled), then:
  python design/icon/filled-icons.py                      # writes src/lib/icons/filled.ts
  python design/icon/filled-icons.py --sheet /tmp/s.html  # outline vs filled at 14/16/20px
The sheet is the review step: check every size in both themes before shipping.
"""
import sys

# (lucide name, outline markup, filled markup)
SPEC = [
    ('inbox',
     '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
     '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path fill="currentColor" d="M2 12h6l2 3h4l2-3h6v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/>'),
    ('list-checks',
     '<path d="M13 5h8"/><path d="M13 12h8"/><path d="M13 19h8"/><path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24"><rect width="24" height="24" fill="white"/><path d="m3.6 7 1.9 1.9 3.4-3.4" stroke="black" stroke-width="2" fill="none"/><path d="m3.6 17 1.9 1.9 3.4-3.4" stroke="black" stroke-width="2" fill="none"/></mask><g mask="url(#MASK)"><rect fill="currentColor" stroke="none" x="1.5" y="1.5" width="9" height="9" rx="2.5"/><rect fill="currentColor" stroke="none" x="1.5" y="12.5" width="9" height="9" rx="2.5"/></g><path d="M14 6h7"/><path d="M14 17h7"/>'),
    ('calendar',
     '<path d="M8 2v3"/><path d="M16 2v3"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path d="M3 9.5h18" stroke="black" stroke-width="2"/><path d="M8 1v5.5M16 1v5.5" stroke="black" stroke-width="3.5" stroke-linecap="round"/></mask><rect fill="currentColor" mask="url(#MASK)" x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v3"/><path d="M16 2v3"/>'),
    ('settings',
     '<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><circle cx="12" cy="12" r="3" fill="black"/></mask><g mask="url(#MASK)"><path fill="currentColor" d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/></g>'),
    ('circle-user',
     '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><clipPath id="MASK-c"><circle cx="12" cy="12" r="8.4"/></clipPath><circle cx="12" cy="10" r="3.25" fill="black"/><path clip-path="url(#MASK-c)" d="M6.6 23V19.4a2.6 2.6 0 0 1 2.6-2.6h5.6a2.6 2.6 0 0 1 2.6 2.6V23z" fill="black"/></mask><circle fill="currentColor" mask="url(#MASK)" cx="12" cy="12" r="10"/>'),
    ('folder',
     '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
     '<path fill="currentColor" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
    ('house',
     '<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path fill="black" d="M10 24V13.8a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8V24z"/></mask><path fill="currentColor" mask="url(#MASK)" d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    ('file',
     '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" d="M14 1v6a1 1 0 0 0 1 1h6"/></mask><path fill="currentColor" mask="url(#MASK)" d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/>'),
    ('star',
     '<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
     '<path fill="currentColor" d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>'),
    ('heart',
     '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>',
     '<path fill="currentColor" d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>'),
    ('bookmark',
     '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
     '<path fill="currentColor" d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>'),
    ('shield',
     '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
     '<path fill="currentColor" d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
    ('zap',
     '<path d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>',
     '<path fill="currentColor" d="M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z"/>'),
    ('message-square-text',
     '<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/><path d="M7 11h10"/><path d="M7 15h6"/><path d="M7 7h8"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" stroke-linecap="round" d="M7 11h10M7 15h6M7 7h8"/></mask><path fill="currentColor" mask="url(#MASK)" d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>'),
    ('archive',
     '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" stroke-linecap="round" d="M10 12h4"/><path stroke="black" stroke-width="1.75" d="M0 8.6h24"/></mask><g mask="url(#MASK)"><rect fill="currentColor" width="20" height="5" x="2" y="3" rx="1"/><path fill="currentColor" d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></g>'),
    ('folder-open',
     '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
     '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/><path fill="currentColor" d="M7.5 11.1A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4z"/>'),
    ('info',
     '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" stroke-linecap="round" d="M12 16v-4"/><path stroke="black" stroke-width="2.5" stroke-linecap="round" d="M12 8h.01"/></mask><circle fill="currentColor" mask="url(#MASK)" cx="12" cy="12" r="10"/>'),
    ('sparkles',
     '<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
     '<path fill="currentColor" d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle fill="currentColor" cx="4" cy="20" r="2"/>'),
    ('layers',
     '<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
     '<path fill="currentColor" d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>'),
    ('box',
     '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" d="m2.5 6.55 9.5 5.45 9.5-5.45M12 23V12"/></mask><path fill="currentColor" mask="url(#MASK)" d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/>'),
    ('database',
     '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" d="M2 5A10 3.6 0 0 0 22 5M2 12A10 3.6 0 0 0 22 12"/></mask><g mask="url(#MASK)"><ellipse fill="currentColor" cx="12" cy="5" rx="9" ry="3"/><path fill="currentColor" d="M3 5V19A9 3 0 0 0 21 19V5z"/></g>'),
    ('store',
     '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>',
     '<path d="M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5"/><path fill="currentColor" d="M17.774 10.31a1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.451 0 1.12 1.12 0 0 0-1.548 0 2.5 2.5 0 0 1-3.452 0 1.12 1.12 0 0 0-1.549 0 2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244z"/><path d="M4 10.95V19a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8.05"/>'),
    ('bot',
     '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" stroke-linecap="round" d="M15 13v2M9 13v2"/></mask><path d="M12 8V4H8"/><rect fill="currentColor" mask="url(#MASK)" width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/>'),
    ('rocket',
     '<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>',
     '<path fill="currentColor" d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path fill="currentColor" d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path fill="currentColor" d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>'),
    ('bug',
     '<path d="M12 20v-9"/><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/><path d="M14.12 3.88 16 2"/><path d="M21 21a4 4 0 0 0-3.81-4"/><path d="M21 5a4 4 0 0 1-3.55 3.97"/><path d="M22 13h-4"/><path d="M3 21a4 4 0 0 1 3.81-4"/><path d="M3 5a4 4 0 0 0 3.55 3.97"/><path d="M6 13H2"/><path d="m8 2 1.88 1.88"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" d="M12 21v-10"/><path stroke="black" stroke-width="1.75" d="M0 7.4h24"/></mask><g mask="url(#MASK)"><path fill="currentColor" d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/><path fill="currentColor" d="M9 7.13V6a3 3 0 1 1 6 0v1.13z"/></g><path d="M14.12 3.88 16 2"/><path d="M21 21a4 4 0 0 0-3.81-4"/><path d="M21 5a4 4 0 0 1-3.55 3.97"/><path d="M22 13h-4"/><path d="M3 21a4 4 0 0 1 3.81-4"/><path d="M3 5a4 4 0 0 0 3.55 3.97"/><path d="M6 13H2"/><path d="m8 2 1.88 1.88"/>'),
    ('cpu',
     '<path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><rect x="8" y="8" width="8" height="8" rx="1" stroke="black" stroke-width="2" fill="none"/></mask><path d="M12 20v2"/><path d="M12 2v2"/><path d="M17 20v2"/><path d="M17 2v2"/><path d="M2 12h2"/><path d="M2 17h2"/><path d="M2 7h2"/><path d="M20 12h2"/><path d="M20 17h2"/><path d="M20 7h2"/><path d="M7 20v2"/><path d="M7 2v2"/><rect fill="currentColor" mask="url(#MASK)" x="4" y="4" width="16" height="16" rx="2"/>'),
    ('pc-case',
     '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M15 14h.01"/><path d="M9 6h6"/><path d="M9 10h6"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" stroke-linecap="round" d="M9 6h6M9 10h6"/><path stroke="black" stroke-width="2.5" stroke-linecap="round" d="M15 14h.01"/></mask><rect fill="currentColor" mask="url(#MASK)" width="14" height="20" x="5" y="2" rx="2"/>'),
    ('globe',
     '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M1 12h22"/></mask><circle fill="currentColor" mask="url(#MASK)" cx="12" cy="12" r="10"/>'),
    ('chart-column',
     '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
     '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><rect fill="currentColor" stroke="none" x="16.25" y="8.25" width="3.5" height="9.5" rx="1"/><rect fill="currentColor" stroke="none" x="11.25" y="4.25" width="3.5" height="13.5" rx="1"/><rect fill="currentColor" stroke="none" x="6.25" y="13.25" width="3.5" height="4.5" rx="1"/>'),
    ('mic',
     '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
     '<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect fill="currentColor" x="9" y="2" width="6" height="13" rx="3"/>'),
    ('send',
     '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2" fill="none" stroke-linecap="round" d="m22.5 1.5-11.6 11.6"/></mask><path fill="currentColor" mask="url(#MASK)" d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/>'),
    ('server',
     '<rect width="20" height="8" x="2" y="2" rx="2" ry="2"/><rect width="20" height="8" x="2" y="14" rx="2" ry="2"/><line x1="6" x2="6.01" y1="6" y2="6"/><line x1="6" x2="6.01" y1="18" y2="18"/>',
     '<mask id="MASK" maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28"><rect x="-2" y="-2" width="28" height="28" fill="white"/><path stroke="black" stroke-width="2.5" stroke-linecap="round" d="M6 6h.01M6 18h.01"/></mask><g mask="url(#MASK)"><rect fill="currentColor" width="20" height="8" x="2" y="2" rx="2"/><rect fill="currentColor" width="20" height="8" x="2" y="14" rx="2"/></g>'),
]

# Strokes stay 1.5px at every size, as the app sets for lucide.
NS = 'vector-effect="non-scaling-stroke"'
ATTRS = ('fill="none" stroke="currentColor" stroke-width="1.5" '
         'stroke-linecap="round" stroke-linejoin="round"')


def ns(markup):
    for tag in ('path', 'rect', 'circle', 'ellipse', 'line', 'polyline'):
        markup = markup.replace(f'<{tag} ', f'<{tag} {NS} ')
    return markup


def pascal(name):
    return ''.join(p.capitalize() for p in name.split('-')) + 'Icon'


def write_ts(path='src/lib/icons/filled.ts'):
    lines = [
        '// Filled variants of lucide icons, shown for a selected item (nav, tabs,',
        '// settings sections). Generated by design/icon/filled-icons.py; edit there.',
        '// `MASK` is replaced with a per-instance id by ActiveIcon.',
        "import type { LucideIcon } from '@lucide/svelte';",
    ]
    lines += [f"import {pascal(n)} from '@lucide/svelte/icons/{n}';" for n, _, _ in SPEC]
    lines += ['', 'export const FILLED = new Map<LucideIcon, string>([']
    lines += [f'\t[{pascal(n)}, `{ns(f)}`],' for n, _, f in SPEC]
    lines += [']);', '']
    open(path, 'w').write('\n'.join(lines))


def write_sheet(path, names):
    def icon(markup, size, uid):
        return (f'<span class="ic"><svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
                f'viewBox="0 0 24 24" {ATTRS}>{ns(markup).replace("MASK", uid)}</svg></span>')
    html = ('<!doctype html><meta charset="utf-8"><style>body{margin:0;font:13px system-ui;display:flex}'
            '.p{padding:24px;flex:1}.dark{background:#1b1b1b;color:#e6e6e6}.light{background:#fafafa;color:#222}'
            'td{padding:8px 14px}td.n{opacity:.6}.ic{display:inline-flex;margin-right:14px;vertical-align:middle}</style>')
    for theme in ('dark', 'light'):
        rows = ''.join(
            f'<tr><td class="n">{n}</td>'
            + ''.join(f'<td>{icon(o, s, "x")}{icon(f, s, f"{theme}-{n}-{s}")}</td>' for s in (14, 16, 20))
            + '</tr>'
            for n, o, f in SPEC if not names or n in names)
        html += f'<div class="p {theme}"><table>{rows}</table></div>'
    open(path, 'w').write(html)


if __name__ == '__main__':
    if sys.argv[1:2] == ['--sheet']:
        write_sheet(sys.argv[2], sys.argv[3:])
    else:
        write_ts()
