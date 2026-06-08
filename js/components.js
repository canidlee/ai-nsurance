// Shared navigation
function renderNav(activePage) {
  return `
  <nav>
    <a class="nav-brand" href="/index.html">AI-<span>nsurance</span></a>
    <div class="nav-links">
      <a class="nav-link${activePage==='how-it-works'?' active':''}" href="/pages/how-it-works.html">How It Works</a>
      <a class="nav-link${activePage==='sample-report'?' active':''}" href="/pages/sample-report.html">Sample Report</a>
      <a class="nav-link${activePage==='about'?' active':''}" href="/pages/about.html">About</a>
      <a class="nav-cta" href="/pages/get-my-review.html#free-finder">Find My Coverage Gaps →</a>
    </div>
  </nav>`;
}

// Shared footer
function renderFooter() {
  return `
  <footer>
    <div class="footer-inner">
      <div class="footer-top">
        <div>
          <a class="footer-brand-name" href="/index.html">AI-<span>nsurance</span></a>
          <div class="footer-tagline">Helping people understand what they have before they need it. No jargon. No conflicts. No surprises.</div>
        </div>
        <div>
          <div class="footer-col-title">Product</div>
          <ul class="footer-links">
            <li><a href="/pages/how-it-works.html">How It Works</a></li>
            <li><a href="/pages/sample-report.html">Sample Report</a></li>
            <li><a href="/pages/get-my-review.html">Free Mistake Finder</a></li>
          </ul>
        </div>
        <div>
          <div class="footer-col-title">Company</div>
          <ul class="footer-links">
            <li><a href="/pages/about.html">About Us</a></li>
            <li><a href="/pages/about.html#giving">Our Giving</a></li>
            <li><a href="mailto:hello@ai-nsurance.com">Contact</a></li>
          </ul>
        </div>
        <div>
          <div class="footer-col-title">Legal</div>
          <ul class="footer-links">
            <li><a href="/pages/privacy.html">Privacy Policy</a></li>
            <li><a href="/pages/terms.html">Terms of Service</a></li>
          </ul>
        </div>
      </div>
      <div class="footer-bottom">
        <div class="footer-copy">© 2026 AI-nsurance. All rights reserved.</div>
        <div class="footer-giving-note">🤝 <span>1% of revenue</span> goes to Miracles for Mighty Milo.</div>
      </div>
    </div>
  </footer>`;
}

// Giving ribbon
function renderGivingRibbon() {
  return `
  <div class="giving-ribbon">
    <p>🤝 <strong>1% of every subscription</strong> goes to <strong>Miracles for Mighty Milo</strong> — funding a cure for a 7-year-old with an ultra-rare disease. <a href="/pages/about.html#giving">Meet Milo →</a></p>
  </div>`;
}

// Inject nav and footer on DOM ready
document.addEventListener('DOMContentLoaded', function() {
  var navEl = document.getElementById('nav-placeholder');
  if (navEl) navEl.outerHTML = renderNav(document.body.dataset.page || '');
  var footerEl = document.getElementById('footer-placeholder');
  if (footerEl) footerEl.outerHTML = renderFooter();
  var ribbonEl = document.getElementById('ribbon-placeholder');
  if (ribbonEl) ribbonEl.outerHTML = renderGivingRibbon();
});
