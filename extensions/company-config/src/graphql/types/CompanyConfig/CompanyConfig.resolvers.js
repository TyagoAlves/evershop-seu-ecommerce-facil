import { getCompanyData } from '../../../company-config.js';

export default {
  Query: {
    companyConfig: () => getCompanyData()
  }
};
