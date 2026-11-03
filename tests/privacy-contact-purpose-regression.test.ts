import assert from 'node:assert/strict';
import test from 'node:test';
import {acceptVenueEmail} from '../src/nexus/venue-email.ts';

test('explicit privacy policy and notice enquiries stay excluded without requiring a privacy mailbox name',()=>{
 for(const label of [
  'Privacy Policy: For any questions about this privacy policy, please contact sarah@operator.org',
  'Questions regarding our privacy notice: sarah@operator.org',
  'Privacy Policy Questions: sarah@operator.org',
  'Privacy notice: If you have any questions, please email sarah@operator.org',
  'Contact us about this privacy policy: sarah@operator.org',
 ])assert.deepEqual(acceptVenueEmail('sarah@operator.org','https://venue.org/privacy-policy','Example Venue',label),{accepted:false,reason:'PRIVACY_OR_DPO'},label);
});

test('newsletter privacy links do not assign the following general contact a privacy role',()=>{
 for(const label of [
  'Subscribe to news. Privacy policy Navigation Home Gather Events About Meet the team Contact Contact us 01453 840006 office@stroudparishchurches.org.uk',
  'Privacy notice Terms and Conditions Contact us General enquiries hello@gmail.com',
 ])assert.equal(acceptVenueEmail(label.endsWith('hello@gmail.com')?'hello@gmail.com':'office@stroudparishchurches.org.uk','https://venue.org/','Example Venue',label).accepted,true,label);
});

test('actual privacy roles and finance/personnel remain held',()=>{
 for(const label of ['Data protection enquiries: sarah@operator.org','Privacy officer: sarah@operator.org','Privacy contact: sarah@operator.org'])assert.equal(acceptVenueEmail('sarah@operator.org','https://venue.org/contact','Example Venue',label).accepted,false,label);
 assert.deepEqual(acceptVenueEmail('sarah@operator.org','https://venue.org/contact','Example Venue','Finance & Personnel Manager: sarah@operator.org'),{accepted:false,reason:'NON_ENQUIRY_DEPARTMENT'});
});
