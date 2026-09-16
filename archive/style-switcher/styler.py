# Archived from build_pages.py when the site was locked to Gallery.
#
# Two pieces. STYLER is the floating control that used to sit in every page
# footer; NO_FLASH is the inline <head> script that applied a remembered pick
# before first paint, so switching styles never flashed the wrong one.
#
# NO_FLASH is inline on purpose and the Content Security Policy allows it by
# SHA-256 hash, computed at build time by inline_script_hashes(). Put it back in
# HEAD and the hash follows automatically — do not add 'unsafe-inline'.

STYLER = """<div class="styler" data-styler>
  <button class="styler__btn" type="button" aria-expanded="false" aria-controls="styler-menu">
    <span class="styler__dots" aria-hidden="true"><i></i><i></i><i></i></span>
    <span class="styler__label">Style: <b data-styler-name>Brick &amp; Stone</b></span>
    <svg class="styler__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>
  </button>
  <div class="styler__menu" id="styler-menu" hidden>
    <p class="styler__title">Mock-up styles</p>
    <button type="button" class="styler__opt" data-style-pick="brick" aria-pressed="true"><span class="styler__sw styler__sw--brick"></span><span><b>Brick &amp; Stone</b><small>Warm stone, brick accent, bold grotesk</small></span></button>
    <button type="button" class="styler__opt" data-style-pick="gallery" aria-pressed="false"><span class="styler__sw styler__sw--gallery"></span><span><b>Gallery</b><small>Editorial serif, white space, oxblood</small></span></button>
    <button type="button" class="styler__opt" data-style-pick="atelier" aria-pressed="false"><span class="styler__sw styler__sw--atelier"></span><span><b>Atelier</b><small>Bone paper, clay accent, serif and grotesk. Pinned headings, a scrolling amenity rail</small></span></button>
    <button type="button" class="styler__opt" data-style-pick="dusk" aria-pressed="false"><span class="styler__sw styler__sw--dusk"></span><span><b>Dusk</b><small>Warm espresso ground, ember accent, a trace of grain</small></span></button>
    <p class="styler__foot">Your pick is remembered on this device.</p>
  </div>
</div>
"""

NO_FLASH = "<script>(function(){try{var s=new URLSearchParams(location.search).get('style')||localStorage.getItem('cs-style');if(s==='night')s='atelier';if(s&&s!=='brick')document.documentElement.setAttribute('data-style',s)}catch(e){}})()</script>"
