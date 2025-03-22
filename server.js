// Simple API server to trigger the scraper
import express from 'express';
import { exec } from 'child_process';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'IKEA Furniture Scraper API',
    endpoints: [
      {
        path: '/api/scrape',
        method: 'POST',
        description: 'Trigger the scraper',
        body: {
          apiKey: 'API key for authentication',
          categoryUrl: '(Optional) IKEA category URL to scrape'
        }
      }
    ]
  });
});

// Main scrape endpoint
app.post('/api/scrape', (req, res) => {
  // Simple API key authentication
  const apiKey = req.body.apiKey;
  const expectedApiKey = process.env.API_KEY;
  
  if (!apiKey || apiKey !== expectedApiKey) {
    return res.status(401).json({
      status: 'error',
      message: 'Unauthorized. Invalid or missing API key.'
    });
  }
  
  // Get category URL if provided
  const categoryUrl = req.body.categoryUrl;
  let command = 'node index.js';
  
  if (categoryUrl) {
    command = `CATEGORY_URL="${categoryUrl}" ${command}`;
  }
  
  // Run the scraper as a child process
  const scraper = exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Exec error: ${error}`);
      return;
    }
    console.log(stdout);
    console.error(stderr);
  });
  
  // Return immediate response
  res.json({
    status: 'started',
    message: 'Scraper started successfully',
    categoryUrl: categoryUrl || 'Using default category'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 