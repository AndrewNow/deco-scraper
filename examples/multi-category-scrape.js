// Example: Multi-category Scraper
// This script shows how to run the scraper for multiple IKEA categories

import { exec } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

// List of IKEA category URLs to scrape
const CATEGORIES = [
  {
    name: 'Beds',
    url: 'https://www.ikea.com/ca/en/cat/beds-bm003/'
  },
  {
    name: 'Sofas',
    url: 'https://www.ikea.com/ca/en/cat/sofas-fu003/'
  },
  {
    name: 'Chairs',
    url: 'https://www.ikea.com/ca/en/cat/chairs-fu002/'
  },
  {
    name: 'Tables',
    url: 'https://www.ikea.com/ca/en/cat/tables-desks-fu004/'
  },
  {
    name: 'Storage',
    url: 'https://www.ikea.com/ca/en/cat/storage-furniture-st001/'
  }
];

// Function to run the scraper for a specific category
async function scrapeCategory(category) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== Starting to scrape category: ${category.name} ===`);
    
    // Run the scraper with the specified category URL
    const scraper = exec(`CATEGORY_URL="${category.url}" node index.js`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error scraping ${category.name}:`, error);
        reject(error);
        return;
      }
      
      // Log output
      console.log(stdout);
      if (stderr) {
        console.error(stderr);
      }
      
      resolve();
    });
  });
}

// Main function to run all categories
async function main() {
  console.log('Starting multi-category scraper');
  
  // Create examples directory if it doesn't exist
  await fs.mkdir('examples/results', { recursive: true });
  
  // Current timestamp for reporting
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  const reportFile = `examples/results/scrape-report-${timestamp}.json`;
  
  const results = {
    startTime: new Date().toISOString(),
    categories: [],
    endTime: null
  };
  
  // Scrape each category sequentially
  for (const category of CATEGORIES) {
    const startTime = new Date();
    
    try {
      await scrapeCategory(category);
      
      results.categories.push({
        name: category.name,
        url: category.url,
        status: 'success',
        startTime: startTime.toISOString(),
        endTime: new Date().toISOString()
      });
    } catch (error) {
      results.categories.push({
        name: category.name,
        url: category.url,
        status: 'error',
        error: error.message,
        startTime: startTime.toISOString(),
        endTime: new Date().toISOString()
      });
    }
  }
  
  // Update end time
  results.endTime = new Date().toISOString();
  
  // Save report
  await fs.writeFile(reportFile, JSON.stringify(results, null, 2));
  
  console.log(`\n=== Multi-category scrape complete ===`);
  console.log(`Report saved to: ${reportFile}`);
}

// Run the main function
main().catch(console.error); 