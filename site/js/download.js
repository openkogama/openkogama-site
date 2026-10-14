(() => {
  const RELEASES = "https://api.github.com/repos/openkogama/openkogama-launcher/releases?per_page=30";
  const link = document.getElementById("download");
  if (!link) return;

  fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } })
    .then(response => response.ok ? response.json() : [])
    .then(releases => {
      const published = releases.filter(release => !release.draft);
      const release = published.find(release => !release.prerelease) || published[0];
      if (!release) return;
      const asset = release.assets.find(asset => /setup\.exe$/i.test(asset.name)) || release.assets.find(asset => /windows\.zip$/i.test(asset.name)) || release.assets[0];
      link.href = asset ? asset.browser_download_url : release.html_url;
      link.title = release.tag_name;
    })
    .catch(() => {});
})();
