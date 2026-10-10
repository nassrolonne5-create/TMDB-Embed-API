const fetch = globalThis.fetch;

async function testVidSrc() {
  const tmdbId = 155;
  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  console.log("Testing VidSrc Step 1...");
  const embedRes = await fetch(`https://vidsrc.to/embed/movie/${tmdbId}`, {
    headers: { "User-Agent": UA }
  });
  const embedHtml = await embedRes.text();
  console.log("Embed html length:", embedHtml.length);
  const vsembedMatch = embedHtml.match(/src="(https:\/\/vsembed\.ru\/embed\/movie\/\d+\/?)"/i);
  console.log("vsembedMatch:", vsembedMatch ? vsembedMatch[1] : null);

  const vsembedUrl = vsembedMatch ? vsembedMatch[1] : `https://vsembed.ru/embed/movie/${tmdbId}/`;

  console.log("Testing VidSrc Step 2...");
  const vsSrcRes = await fetch(`https://vsembed.ru/vs_src.php?type=movie&id=${tmdbId}`, {
    headers: {
      "User-Agent": UA,
      "Referer": vsembedUrl
    }
  });
  const vsSrcJson = await vsSrcRes.json();
  console.log("vsSrcJson:", vsSrcJson);

  if (vsSrcJson && vsSrcJson.src) {
    console.log("Testing VidSrc Step 3...");
    const gatewayRes = await fetch(vsSrcJson.src, {
      headers: {
        "User-Agent": UA,
        "Referer": "https://vsembed.ru/"
      }
    });
    const gatewayHtml = await gatewayRes.text();
    const cfgMatch = gatewayHtml.match(/window\.CFG\s*=\s*(\{.*?\});/);
    console.log("cfgMatch:", cfgMatch ? cfgMatch[1] : null);

    if (cfgMatch) {
      const cfg = JSON.parse(cfgMatch[1]);
      const host = new URL(vsSrcJson.src).origin;
      const playerFullUrl = `${host}${cfg.playerUrl}`;
      console.log("Testing VidSrc Step 4:", playerFullUrl);

      const playerRes = await fetch(playerFullUrl, {
        headers: {
          "User-Agent": UA,
          "Referer": vsSrcJson.src
        }
      });
      const playerHtml = await playerRes.text();
      console.log("Player HTML length:", playerHtml.length);
      const hlsMatch = playerHtml.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      console.log("hlsMatch:", hlsMatch ? hlsMatch[1] : null);

      // Check all script tags in playerHtml
      const scriptMatches = playerHtml.match(/<script[\s\S]*?<\/script>/gi) || [];
      console.log("Total script tags in playerHtml:", scriptMatches.length);
      for (const sm of scriptMatches) {
        if (!sm.includes("disable-devtool") && !sm.includes("histats")) {
          console.log("Script snippet:\n", sm.slice(0, 400));
        }
      }
    }
  }
}

testVidSrc().catch(console.error);
