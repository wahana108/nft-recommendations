const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const app = express();
const port = process.env.PORT || 3007;

const supabaseUrl = 'https://jmqwuaybvruzxddsppdh.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptcXd1YXlidnJ1enhkZHNwcGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA0MTUxNzEsImV4cCI6MjA1NTk5MTE3MX0.ldNdOrsb4BWyFRwZUqIFEbmU0SgzJxiF_Z7eGZPKZJg';
const supabase = createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: true, persistSession: true } });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const ADMIN_EMAIL = 'ramawan@live.com';

const authenticate = async (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).send('No token provided');
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).send('Unauthorized');
  req.user = user;

  req.user.role = user.email === ADMIN_EMAIL ? 'admin' : 'vendor';
  next();
};

const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).send('Only admins can perform this action');
  }
  next();
};

app.get('/top-vendors', authenticate, async (req, res) => {
  try {
    const { data: vendors, error } = await supabase
      .from('vendor_score')
      .select('vendor_id, score')
      .order('score', { ascending: false })
      .limit(3);
    if (error) throw error;
    res.json(vendors);
  } catch (error) {
    console.error('Error fetching top vendors:', error.message);
    res.status(500).send(error.message);
  }
});

app.get('/recommendations', authenticate, async (req, res) => {
  try {
    console.log('Fetching NFT recommendations');
    const { data: recs, error: recError } = await supabase
      .from('nft_recommendations')
      .select('nft_id, vendor_id, added_at, status')
      .eq('status', 'available')
      .order('added_at', { ascending: true });
    if (recError) throw recError;

    const recommendations = [];
    for (const rec of recs) {
      const { data: nft, error: nftError } = await supabase
        .from('nfts')
        .select('id, title, description, vendor_id, price, image_url') // Sudah sesuai dengan tabel Anda
        .eq('id', rec.nft_id)
        .single();
      if (nftError) throw nftError;

      recommendations.push({
        nft_id: rec.nft_id,
        title: nft.title || 'Vendor NFT',
        vendor_id: rec.vendor_id,
        email: nft.description.split(' | ').pop() || rec.vendor_id,
        price: nft.price || 100000,
        added_at: rec.added_at,
        image_url: nft.image_url || null // Menggunakan image_url yang ada
      });
    }

    console.log('Recommendations:', recommendations);
    res.json({ recommendations, maxTopVendors: 3, backups: 0 });
  } catch (error) {
    console.error('Error fetching recommendations:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/place-recommendation', authenticate, async (req, res) => {
  try {
    const { nft_id } = req.body;
    const vendorId = req.user.id;

    console.log('Vendor placing recommendation for NFT:', nft_id);

    const { data: topVendors, error: vendorError } = await supabase
      .from('vendor_score')
      .select('vendor_id')
      .order('score', { ascending: false })
      .limit(3);
    if (vendorError) throw vendorError;

    if (!topVendors.some(v => v.vendor_id === vendorId)) {
      return res.status(403).send('Only top 3 vendors can place recommendations');
    }

    const { data: nft, error: nftError } = await supabase
      .from('nfts')
      .select('id, vendor_id')
      .eq('id', nft_id)
      .eq('vendor_id', vendorId)
      .single();
    if (nftError || !nft) return res.status(404).send('NFT not found or not owned by vendor');

    const { data: existingRec, error: recError } = await supabase
      .from('nft_recommendations')
      .select('nft_id')
      .eq('vendor_id', vendorId)
      .eq('status', 'available')
      .limit(1);
    if (recError) throw recError;
    if (existingRec.length > 0) {
      return res.status(400).send('Vendor can only place 1 NFT in recommendations');
    }

    const { error: insertError } = await supabase
      .from('nft_recommendations')
      .insert({
        nft_id,
        vendor_id: vendorId,
        added_at: new Date().toISOString(),
        status: 'available'
      });
    if (insertError) throw insertError;

    console.log('Recommendation placed successfully');
    res.send('Recommendation placed successfully');
  } catch (error) {
    console.error('Error placing recommendation:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/buy-nft', authenticate, async (req, res) => {
  try {
    const { nft_id, seller_id } = req.body;
    const buyerId = req.user.id;

    console.log('Buyer requesting to buy NFT:', nft_id, 'from seller:', seller_id);

    const { data: rec, error: recError } = await supabase
      .from('nft_recommendations')
      .select('nft_id, vendor_id')
      .eq('nft_id', nft_id)
      .eq('vendor_id', seller_id)
      .eq('status', 'available')
      .single();
    if (recError || !rec) return res.status(404).send('NFT not found or not available');

    const { error: transError } = await supabase
      .from('transactions')
      .insert({
        nft_id,
        seller_id,
        buyer_id: buyerId,
        status: 'pending',
        type: 'sale',
        created_at: new Date().toISOString()
      });
    if (transError) throw transError;

    res.send('Buy request sent. Awaiting admin confirmation.');
  } catch (error) {
    console.error('Error in buy request:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/confirm-sale', authenticate, async (req, res) => {
  try {
    const { transaction_id } = req.body;
    const adminId = req.user.id;

    console.log('Admin confirming sale for transaction:', transaction_id);

    const { data: transaction, error: transError } = await supabase
      .from('transactions')
      .select('nft_id, seller_id, buyer_id, status')
      .eq('id', transaction_id)
      .eq('status', 'pending')
      .single();
    if (transError || !transaction) return res.status(404).send('Transaction not found or not pending');

    const { error: updateError } = await supabase
      .from('transactions')
      .update({ status: 'completed' })
      .eq('id', transaction_id);
    if (updateError) throw updateError;

    const { error: recUpdateError } = await supabase
      .from('nft_recommendations')
      .update({ status: 'bought' })
      .eq('nft_id', transaction.nft_id)
      .eq('vendor_id', transaction.seller_id);
    if (recUpdateError) throw recUpdateError;

    console.log('Sale confirmed successfully by admin');
    res.send('Sale confirmed successfully by admin');
  } catch (error) {
    console.error('Error confirming sale:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/profit-sharing', authenticate, async (req, res) => {
  try {
    const { nft_id_to_replace, buyback_nft_id } = req.body;
    const vendorId = req.user.id;
    let buybackError;

    console.log('Vendor initiating profit sharing for NFT:', buyback_nft_id, 'to replace:', nft_id_to_replace);

    const { data: topVendors, error: vendorError } = await supabase
      .from('vendor_score')
      .select('vendor_id')
      .order('score', { ascending: false })
      .limit(3);
    if (vendorError) throw vendorError;

    if (!topVendors.some(v => v.vendor_id === vendorId)) {
      return res.status(403).send('Only top 3 vendors can initiate profit sharing');
    }

    const { data: recToReplace, error: recReplaceError } = await supabase
      .from('nft_recommendations')
      .select('nft_id, vendor_id, status')
      .eq('nft_id', nft_id_to_replace)
      .eq('status', 'available')
      .single();
    if (recReplaceError || !recToReplace) return res.status(404).send('Recommendation NFT not found or not available');

    const { data: buybackNft, error: nftError } = await supabase
      .from('nfts')
      .select('id, vendor_id')
      .eq('id', buyback_nft_id)
      .eq('vendor_id', vendorId)
      .single();
    if (nftError || !buybackNft) return res.status(404).send('Buyback NFT not found or not owned by vendor');

    const { data: newTransaction, error: transError } = await supabase
      .from('transactions')
      .insert({
        nft_id: buyback_nft_id,
        seller_id: vendorId,
        buyer_id: null,
        status: 'pending',
        type: 'profit_sharing',
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();
    if (transError) throw transError;

    const transactionId = newTransaction.id;

    const { error: insertError } = await supabase
      .from('buyback2')
      .insert({
        nft_id: buyback_nft_id,
        vendor_id: vendorId,
        buyer_id: null,
        proof_url: null,
        status: 'pending'
      });
    buybackError = insertError;
    if (buybackError) throw buybackError;

    const { data: buybackCount, error: countError } = await supabase
      .from('buyback2')
      .select('vendor_id', { count: 'exact' })
      .eq('vendor_id', vendorId)
      .eq('status', 'completed');
    if (countError) throw countError;

    const newScore = buybackCount.length;
    const { error: scoreUpdateError } = await supabase
      .from('vendor_score')
      .upsert(
        { vendor_id: vendorId, score: newScore },
        { onConflict: 'vendor_id' }
      );
    if (scoreUpdateError) throw scoreUpdateError;

    res.json({
      message: 'Profit sharing request sent. Awaiting admin confirmation.',
      transactionId,
      nftIdToReplace: nft_id_to_replace
    });
  } catch (error) {
    console.error('Error in profit sharing:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/confirm-profit-sharing', authenticate, requireAdmin, async (req, res) => {
  try {
    const { transaction_id, nft_id_to_replace } = req.body;
    const adminId = req.user.id;

    console.log('Admin confirming profit sharing for transaction:', transaction_id);

    const { data: transaction, error: transError } = await supabase
      .from('transactions')
      .select('nft_id, seller_id, status, type')
      .eq('id', transaction_id)
      .eq('type', 'profit_sharing')
      .eq('status', 'pending')
      .single();
    if (transError || !transaction) return res.status(404).send('Transaction not found or not pending');

    const buyerId = req.body.buyer_id || transaction.seller_id;

    const { error: updateError } = await supabase
      .from('transactions')
      .update({ status: 'completed', buyer_id: buyerId })
      .eq('id', transaction_id);
    if (updateError) throw updateError;

    const { error: deleteError } = await supabase
      .from('nft_recommendations')
      .delete()
      .eq('nft_id', nft_id_to_replace)
      .eq('status', 'available');
    if (deleteError) throw deleteError;

    const { error: insertError } = await supabase
      .from('nft_recommendations')
      .insert({
        nft_id: transaction.nft_id,
        vendor_id: transaction.seller_id,
        added_at: new Date().toISOString(),
        status: 'available'
      });
    if (insertError) throw insertError;

    const { error: buybackUpdateError } = await supabase
      .from('buyback2')
      .update({
        status: 'completed',
        buyer_id: buyerId,
        proof_url: req.body.proof_url || null
      })
      .eq('nft_id', transaction.nft_id)
      .eq('vendor_id', transaction.seller_id)
      .eq('status', 'pending');
    if (buybackUpdateError) throw buybackUpdateError;

    const { data: buybackCount, error: countError } = await supabase
      .from('buyback2')
      .select('vendor_id', { count: 'exact' })
      .eq('vendor_id', transaction.seller_id)
      .eq('status', 'completed');
    if (countError) throw countError;

    const newScore = buybackCount.length;
    const { error: scoreUpdateError } = await supabase
      .from('vendor_score')
      .upsert(
        { vendor_id: transaction.seller_id, score: newScore },
        { onConflict: 'vendor_id' }
      );
    if (scoreUpdateError) throw scoreUpdateError;

    console.log('Profit sharing confirmed successfully by admin');
    res.send('Profit sharing confirmed successfully by admin');
  } catch (error) {
    console.error('Error confirming profit sharing:', error.message);
    res.status(500).send(error.message);
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Logging in with:', email);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    console.log('Login successful, token:', data.session.access_token);
    res.json({ token: data.session.access_token });
  } catch (error) {
    console.error('Login error:', error.message);
    res.status(401).send(error.message);
  }
});

app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Registering with:', email);
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
    console.log('Registration successful');
    res.send('Registration successful! Please login.');
  } catch (error) {
    console.error('Registration error:', error.message);
    res.status(400).send(error.message);
  }
});

app.get('/pending-transactions', authenticate, async (req, res) => {
  try {
    const { data: transactions, error } = await supabase
      .from('transactions')
      .select('id, nft_id, seller_id, buyer_id, status, type, created_at')
      .eq('status', 'pending');
    if (error) throw error;
    res.json(transactions);
  } catch (error) {
    console.error('Error fetching pending transactions:', error.message);
    res.status(500).send(error.message);
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
