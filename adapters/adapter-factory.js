import { IkeaAdapter } from './retailers/ikea-adapter.js';
import { WayfairAdapter } from './retailers/wayfair-adapter.js';
import { ArticleAdapter } from './retailers/article-adapter.js';
import { FirstDibsAdapter } from './retailers/firstdibs-adapter.js';

/**
 * Adapter Factory
 * 
 * This factory creates and returns the appropriate adapter for a given retailer.
 */
export class AdapterFactory {
  /**
   * Get the adapter for a specific retailer
   * @param {string} retailer - The retailer name (case insensitive)
   * @param {Object} options - Options for the adapter
   * @returns {BaseAdapter} The adapter instance
   * @throws {Error} If the retailer is not supported
   */
  static getAdapter(retailer, options = {}) {
    const retailerLower = retailer.toLowerCase();
    
    switch (retailerLower) {
      case 'ikea':
        return new IkeaAdapter(options.country, options.language);
      case 'wayfair':
        return new WayfairAdapter(options.country);
      case 'article':
        return new ArticleAdapter(options.country, options.language);
      case '1stdibs':
        return new FirstDibsAdapter(options.country, options.language);
      default:
        throw new Error(`Unsupported retailer: ${retailer}`);
    }
  }
  
  /**
   * Get a list of supported retailers
   * @returns {Array<string>} Array of supported retailer names
   */
  static getSupportedRetailers() {
    return ['IKEA', 'Wayfair', 'Article', '1stDibs'];
  }
} 