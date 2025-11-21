// server.js - Wishlist+ Backend API
// Pour déployer sur Render.com

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Cache simple
const cache = new Map();
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

// Route principale
app.get('/', (req, res) => {
  res.json({
    name: 'Wishlist+ API',
    version: '2.0.0',
    status: 'running',
    endpoints: {
      '/api/app/:appId': 'Get app info',
      '/api/apps': 'Get multiple apps (POST)',
      '/health': 'Health check'
    }
  });
});

// Health check (pour Render)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Fonction pour scraper le Play Store
async function scrapePlayStore(appId) {
  try {
    const url = `https://play.google.com/store/apps/details?id=${appId}&hl=en&gl=US`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    
    // Extraire le nom de l'app
    let name = appId.split('.').pop();
    const nameMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    if (nameMatch) {
      name = nameMatch[1].trim();
    }
    
    // Extraire l'icône
    let icon = null;
    const iconPatterns = [
      /src="(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/,
      /"(https:\/\/play-lh\.googleusercontent\.com\/[^"]+)"/
    ];
    for (const pattern of iconPatterns) {
      const match = html.match(pattern);
      if (match && match[1].includes('=w')) {
        icon = match[1].split('=')[0] + '=w192-h192';
        break;
      }
    }
    
    // Extraire le prix
    let price = 0;
    let isFree = true;
    
    // Chercher les indicateurs de prix
    if (html.includes('Buy') || html.includes('$') || html.includes('€') || html.includes('£')) {
      const pricePatterns = [
        /\$(\d+\.?\d*)/,
        /€(\d+\.?\d*)/,
        /£(\d+\.?\d*)/,
        /(\d+\.?\d*)\s*(?:USD|EUR|GBP)/
      ];
      for (const pattern of pricePatterns) {
        const match = html.match(pattern);
        if (match) {
          price = parseFloat(match[1]);
          isFree = false;
          break;
        }
      }
    }
    
    // Extraire le développeur
    let developer = 'Unknown';
    const devMatch = html.match(/,"([^"]+)",null,null,null,\[\[\["\/store\/apps\/developer/);
    if (devMatch) {
      developer = devMatch[1];
    }
    
    // Extraire la note
    let rating = null;
    const ratingMatch = html.match(/(\d\.\d)\s*star/i);
    if (ratingMatch) {
      rating = parseFloat(ratingMatch[1]);
    }

    return {
      id: appId,
      name: name,
      icon: icon,
      price: price,
      isFree: isFree,
      developer: developer,
      rating: rating,
      url: `https://play.google.com/store/apps/details?id=${appId}`,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    console.error(`Error scraping ${appId}:`, error.message);
    throw error;
  }
}

// API: Récupérer une app
app.get('/api/app/:appId', async (req, res) => {
  try {
    const { appId } = req.params;
    
    // Vérifier le cache
    const cached = cache.get(appId);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      console.log(`Cache hit: ${appId}`);
      return res.json(cached.data);
    }
    
    console.log(`Fetching: ${appId}`);
    const appInfo = await scrapePlayStore(appId);
    
    // Mettre en cache
    cache.set(appId, { data: appInfo, timestamp: Date.now() });
    
    res.json(appInfo);
  } catch (error) {
    console.error('Error:', error.message);
    res.status(404).json({
      error: 'App not found',
      message: error.message,
      appId: req.params.appId
    });
  }
});

// API: Récupérer plusieurs apps
app.post('/api/apps', async (req, res) => {
  try {
    const { appIds } = req.body;
    
    if (!Array.isArray(appIds)) {
      return res.status(400).json({ error: 'appIds must be an array' });
    }
    
    console.log(`Fetching ${appIds.length} apps...`);
    
    const results = await Promise.allSettled(
      appIds.map(async (appId) => {
        // Vérifier le cache
        const cached = cache.get(appId);
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
          return cached.data;
        }
        
        const appInfo = await scrapePlayStore(appId);
        cache.set(appId, { data: appInfo, timestamp: Date.now() });
        return appInfo;
      })
    );
    
    const apps = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
    
    const errors = results
      .filter(r => r.status === 'rejected')
      .map(r => r.reason?.message || 'Unknown error');
    
    res.json({
      apps,
      total: apps.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch apps', message: error.message });
  }
});

// Nettoyer le cache périodiquement
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_DURATION) {
      cache.delete(key);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`Cache cleaned: ${cleaned} items removed`);
  }
}, 60 * 60 * 1000); // Toutes les heures

// Démarrer le serveur
app.listen(PORT, () => {
  console.log('=================================');
  console.log(`🚀 Wishlist+ API v2.0.0`);
  console.log(`📡 Port: ${PORT}`);
  console.log(`✅ Ready!`);
  console.log('=================================');
});