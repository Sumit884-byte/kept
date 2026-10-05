import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

// pdfkit loads these through a package import wildcard. A direct require
// is what puts the font files in the production bundle.
require('pdfkit/standard-fonts/Courier')
require('pdfkit/standard-fonts/CourierBold')
require('pdfkit/standard-fonts/CourierBoldOblique')
require('pdfkit/standard-fonts/CourierOblique')
require('pdfkit/standard-fonts/Helvetica')
require('pdfkit/standard-fonts/HelveticaBold')
require('pdfkit/standard-fonts/HelveticaBoldOblique')
require('pdfkit/standard-fonts/HelveticaOblique')
require('pdfkit/standard-fonts/Symbol')
require('pdfkit/standard-fonts/TimesBold')
require('pdfkit/standard-fonts/TimesBoldItalic')
require('pdfkit/standard-fonts/TimesItalic')
require('pdfkit/standard-fonts/TimesRoman')
require('pdfkit/standard-fonts/ZapfDingbats')
