import { getBaseData } from './admin.js';
import { loadSystemState, matchMetadata, fail } from '../lib/store.js';
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (req.method !== 'GET') return res.status(405).json({detail:'Method not allowed'});
  try {
    const root = await loadSystemState();
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res.status(200).json(matchMetadata(root).map(match => ({ ...match,
      blocks: Object.keys((root.match_templates?.[match.id] || getBaseData().match_templates?.[match.id] || getBaseData().base_state).blocks || {})
    })));
  }
  catch(error) { return fail(res,error); }
}
