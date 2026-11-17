// Runtime settings for the Technical Checklist autofill extension.
// Selectors are lists: entries cover Salesforce Lightning and the bundled mock pages. The Lightning
// ones follow Moonfill (github.com/OptimusRodier/moonfill), which fills fields on awin.lightning.force.com,
// but the Technical Checklist itself is unverified. Use the panel's "Check page" report to correct them.
globalThis.TCA_CONFIG = {
  version: '1.0.0',
  checklistTitle: 'Technical Checklist',

  // Date fields (Pixel Sent, Successful Tracking Test) are typed in this format, as a user would type
  // them. It also sets the day/month order used to read numeric dates such as 03/11/2026.
  // For a US-locale Salesforce user, change it to 'MM/DD/YYYY'.
  dateFormat: 'DD/MM/YYYY',

  // Where Pixel Sent's date comes from: the line in the record's history box marking its creation.
  history: {
    title: 'Implementation History',      // box title; a count such as "(6)" or "(10+)" after it is fine
    createdText: ['Created.', 'Created']  // text of the cell that marks the creation line
  },

  // Platform detection: the client's site comes from this record field, and its page (HTML plus
  // response headers) is searched for each platform's signs. The platform with the most matching
  // signs wins; a tie, or no match, means "no platform detected" and the default fill is used.
  // Signs are best guesses: correct them here when a site is detected wrongly.
  landingPageLabel: 'Landing Page URL',
  platformSigns: {
    'BigCommerce': [/cdn\d*\.bigcommerce\.com/i, /mybigcommerce\.com/i, /stencil-utils/i, /\bBCData\b/],
    'Lightspeed': [/webshopapp\.com/i, /shoplightspeed\.com/i, /lightspeedhq/i, /\bseoshop\b/i],
    'Magento': [/text\/x-magento-init/i, /\bMagento_[A-Z]/, /mage\/cookies/i, /\/static\/version\d+\/frontend\//i],
    'OpenCart': [/index\.php\?route=(common|product|checkout|account)\//i, /catalog\/view\/(theme|javascript)\//i, /\bOpenCart\b/i],
    'PrestaShop': [/var prestashop\s*=/i, /\/modules\/ps_[a-z]/i, /\bprestashop\b/i],
    'Salesforce Commerce Cloud': [/\/on\/demandware\.(store|static)\//i, /\bdemandware\b/i, /dwanalytics/i, /\/dw\/shop\//i],
    'Shopify': [/cdn\.shopify\.com/i, /\bShopify\.theme\b/, /\bShopify\.shop\s*=/, /myshopify\.com/i, /shopify-digital-wallet/i],
    'Shoplazza': [/shoplazza\.com/i, /\bshoplazza\b/i, /\bSHOPLAZZA\b/],
    'Shopware 5': [/\/themes\/Frontend\//i, /\/web\/cache\/\d+_/i, /\bStateManager\b/, /jQuery\.publish/],
    'Shopware 6': [/\/bundles\/storefront\//i, /window\.router\s*=/, /frontend\.checkout\./i, /\/theme\/[0-9a-f]{32}\//i],
    'Squarespace': [/static1\.squarespace\.com/i, /Static\.SQUARESPACE_CONTEXT/, /squarespace-cdn\.com/i, /\bsquarespace\b/i],
    'Wix': [/static\.wixstatic\.com/i, /parastorage\.com/i, /x-wix-request-id/i, /wixsite\.com/i, /\bwix-bolt\b/i],
    'WooCommerce': [/wp-content\/plugins\/woocommerce\//i, /woocommerce-no-js/i, /\bwc-block-/i, /woocommerce_params|wc_add_to_cart_params/]
  },

  // Usage reporting: who used the extension comes from this record field (a person, not the logged-in
  // user). Records hold the person, tool, action, outcome, a reason code and the version, nothing about
  // the client. They are sent to this SharePoint list once 'site' is set, e.g.
  // 'https://zanox.sharepoint.com/teams/<team>'. While it is empty they wait in the browser.
  assignedTcLabel: 'Assigned TC',
  usage: { site: '', list: 'Plugin usage' },

  selectors: {
    // The visible record page. Lightning keeps recently viewed records in the page, hidden.
    activeRoot: '.oneContent.active',
    // Elements whose text may be the checklist's title.
    title: 'h1, h2, h3, h4, span, button, a, legend, [role="heading"]',
    // Container holding one checklist: nearest ancestor of the title that contains checklist fields.
    section: 'records-record-layout-section, force-record-layout-section, flexipage-field-section2, .slds-section, section',
    // A field's label element.
    label: '.test-id__field-label, .slds-form-element__label, .slds-form-element__legend, .field-label, label, legend',
    // One field (label + value or control). Tried in this order; first match wins.
    item: ['records-record-layout-item', 'force-record-layout-item', '.field-row', '.slds-form-element'],
    // Read-only value outside edit mode.
    viewValue: '.test-id__field-value, .slds-form-element__static, .field-value',
    // Pencil (inline edit) button in a field.
    editButton: 'button.test-id__inline-edit-trigger, button[title^="Edit "]',
    // Lightning picklist trigger, and its options once opened.
    combobox: 'button[role="combobox"]',
    option: '[role="option"], lightning-base-combobox-item',
    // Section expand/collapse toggle.
    sectionToggle: 'button.slds-section__title-action, button.slds-accordion__summary-action',
    native: 'select, textarea, input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([role="combobox"])',
    // Shared Save button shown in edit mode (by name, or a "Save" button in the edit footer).
    saveButton: 'button[name="SaveEdit"]',
    saveFooter: 'records-form-footer, force-record-edit-footer, .slds-docked-form-footer',
    // Messages shown when a save fails.
    error: 'records-record-edit-error, .forceFormPageError, .pageLevelErrors, .slds-popover_error, .slds-has-error .slds-form-element__help, .save-error',
    // The history box (a related-list card) and one line within it (table row or tile).
    historyCard: 'article, .slds-card, lst-related-list-single-container, force-related-list-single-container, section',
    historyRow: 'tr, [role="row"], li, .slds-tile',
    // Text that is not part of a label: required asterisk, screen-reader text, help icon.
    labelNoise: '.slds-assistive-text, abbr, .slds-required, lightning-helptext, lightning-icon, button, svg'
  },

  timeouts: { editMode: 8000, dropdown: 3000, save: 15000, readBack: 8000 },
  pollMs: 150
};
