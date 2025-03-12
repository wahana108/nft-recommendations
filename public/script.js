console.log('script.js loaded');

const supabase = window.supabase.createClient('https://jmqwuaybvruzxddsppdh.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImptcXd1YXlidnJ1enhkZHNwcGRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDA0MTUxNzEsImV4cCI6MjA1NTk5MTE3MX0.ldNdOrsb4BWyFRwZUqIFEbmU0SgzJxiF_Z7eGZPKZJg');
let token = null;

async function login(email, password) {
  try {
    console.log('Logging in with:', email);
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) throw new Error(`Login failed: ${res.status}`);
    const { token: newToken } = await res.json();
    token = newToken;
    localStorage.setItem('authToken', token);
    console.log('Login successful, token:', token);
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('pool').style.display = 'block';
    loadRecommendations();
    checkVendorStatus();
  } catch (error) {
    console.error('Login error:', error.message);
    alert('Login failed: ' + error.message);
  }
}

async function register(email, password) {
  try {
    console.log('Registering with:', email);
    const res = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    if (!res.ok) throw new Error(`Register failed: ${res.status}`);
    const result = await res.text();
    console.log('Registration successful:', result);
    alert('Registration successful! Please login.');
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
  } catch (error) {
    console.error('Registration error:', error.message);
    alert('Registration failed: ' + error.message);
  }
}

async function logout() {
  try {
    console.log('Logging out');
    token = null;
    localStorage.removeItem('authToken');
    console.log('Logout successful');
    document.getElementById('pool').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
    hideVendorActions();
  } catch (error) {
    console.error('Logout error:', error.message);
    alert('Logout failed: ' + error.message);
  }
}

async function loadRecommendations() {
  try {
    console.log('Loading NFT recommendations');
    const res = await fetch('/recommendations', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    const { recommendations, maxTopVendors, backups } = await res.json();
    console.log('Recommendations loaded:', recommendations);
    const list = document.getElementById('recommendations');
    list.innerHTML = '';
    if (!recommendations || recommendations.length === 0) {
      list.innerHTML = `<p>No recommendations yet. Max top vendors: ${maxTopVendors || 3}, Backups: ${backups || 0}</p>`;
    } else {
      recommendations.forEach(rec => {
        list.innerHTML += `
          <div class="nft-card">
            <p>
              NFT ID: ${rec.nft_id} | 
              Title: ${rec.title || 'No Title'} | 
              Vendor: ${rec.email} | 
              Price: Rp${rec.price} | 
              Added: ${new Date(rec.added_at || Date.now()).toLocaleString()} | 
              Buybacks: <span id="buyback-count-${rec.vendor_id}"></span>
            </p>
            ${rec.image_url ? `<img src="${rec.image_url}" alt="${rec.title || 'NFT Image'}" class="nft-image">` : '<p>No image available</p>'}
            <button class="buy-btn" data-nft-id="${rec.nft_id}" data-vendor-id="${rec.vendor_id}">Buy</button>
          </div>`;
        fetchBuybackCount(rec.vendor_id);
      });
      list.innerHTML += `<p>Max Top Vendors: ${maxTopVendors || 3}, Backups: ${backups || 0}, Total Pool Capacity: ${maxTopVendors || 3} NFTs (FIFO Order)</p>`;
    }
    document.querySelectorAll('.buy-btn').forEach(btn => {
      btn.addEventListener('click', () => buyNft(btn.dataset.nftId, btn.dataset.vendorId));
    });
  } catch (error) {
    console.error('Error loading recommendations:', error.message);
    document.getElementById('recommendations').innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

async function fetchBuybackCount(vendorId) {
  try {
    const { data, error } = await supabase
      .from('buyback2')
      .select('id', { count: 'exact' })
      .eq('vendor_id', vendorId)
      .eq('status', 'completed');
    if (error) throw error;
    document.getElementById(`buyback-count-${vendorId}`).textContent = data.length;
  } catch (error) {
    console.error('Error fetching buyback count:', error.message);
    document.getElementById(`buyback-count-${vendorId}`).textContent = 'N/A';
  }
}

async function checkVendorStatus() {
  try {
    console.log('Checking vendor status with token:', token);
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) {
      console.error('Failed to get user data:', error?.message || 'No user');
      showVendorActions(); // Tampilkan tombol untuk debugging
      return;
    }
    const vendorId = user.id;
    console.log('User ID:', vendorId);
    if (!vendorId) {
      console.log('No vendor ID, hiding actions');
      hideVendorActions();
      return;
    }

    const res = await fetch('/top-vendors', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      console.error('Fetch top vendors failed:', res.status);
      showVendorActions(); // Tampilkan tombol untuk debugging
      return;
    }
    const topVendors = await res.json();
    console.log('Top vendors:', topVendors);

    const isTopVendor = topVendors.some(v => v.vendor_id === vendorId);
    if (isTopVendor) {
      const { data: existingRec, error: recError } = await supabase
        .from('nft_recommendations')
        .select('nft_id')
        .eq('vendor_id', vendorId)
        .eq('status', 'available')
        .limit(1);
      if (recError) console.error('Error checking existing rec:', recError.message);
      if (existingRec && existingRec.length > 0) {
        document.getElementById('reward-btn').style.display = 'block';
        document.getElementById('reward-btn').disabled = true;
        document.getElementById('reward-btn').textContent = 'Reward Placed';
      } else {
        document.getElementById('reward-btn').style.display = 'block';
        document.getElementById('reward-btn').disabled = false;
        document.getElementById('reward-btn').textContent = 'Place Reward NFT';
      }
      document.getElementById('profit-sharing-btn').style.display = 'block';
      document.getElementById('confirm-profit-btn').style.display = 'block';
    } else {
      hideVendorActions();
    }
  } catch (error) {
    console.error('Error in checkVendorStatus:', error.message);
    showVendorActions(); // Tampilkan tombol untuk debugging
  }
}

function hideVendorActions() {
  document.getElementById('reward-btn').style.display = 'none';
  document.getElementById('profit-sharing-btn').style.display = 'none';
  document.getElementById('confirm-profit-btn').style.display = 'none';
}

function showVendorActions() {
  document.getElementById('reward-btn').style.display = 'block';
  document.getElementById('profit-sharing-btn').style.display = 'block';
  document.getElementById('confirm-profit-btn').style.display = 'block';
}

async function placeRecommendation() {
  try {
    const nftId = document.getElementById('nft-id').value;
    if (!nftId) return alert('Please enter NFT ID');
    console.log('Placing recommendation for NFT:', nftId);
    const res = await fetch('/place-recommendation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nft_id: parseInt(nftId) })
    });
    if (!res.ok) throw new Error(`Place failed: ${res.status}`);
    const result = await res.text();
    console.log('Recommendation placed:', result);
    document.getElementById('action-result').innerHTML = `<p>${result}</p>`;
    document.getElementById('reward-btn').disabled = true;
    document.getElementById('reward-btn').textContent = 'Reward Placed';
    loadRecommendations();
  } catch (error) {
    console.error('Error placing recommendation:', error.message);
    document.getElementById('action-result').innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

async function buyNft(nftId, vendorId) {
  try {
    console.log('Requesting to buy NFT:', nftId, 'from vendor:', vendorId);
    const res = await fetch('/buy-nft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nft_id: parseInt(nftId), seller_id: vendorId })
    });
    if (!res.ok) throw new Error(`Buy request failed: ${res.status}`);
    const result = await res.text();
    console.log('Buy request result:', result);
    alert(result + '\nVendor will confirm the sale manually.');
  } catch (error) {
    console.error('Error in buy request:', error.message);
    alert('Error: ' + error.message);
  }
}

async function confirmSale() {
  try {
    const transactionId = prompt('Enter Transaction ID to confirm:');
    if (!transactionId) return alert('Please enter Transaction ID');
    console.log('Confirming sale for transaction:', transactionId);
    const res = await fetch('/confirm-sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ transaction_id: parseInt(transactionId) })
    });
    if (!res.ok) throw new Error(`Confirm failed: ${res.status}`);
    const result = await res.text();
    console.log('Sale confirmed:', result);
    document.getElementById('action-result').innerHTML = `<p>${result}</p>`;
    loadRecommendations();
    checkVendorStatus();
  } catch (error) {
    console.error('Error confirming sale:', error.message);
    document.getElementById('action-result').innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

async function confirmProfitSharing(transactionId, nftIdToReplace) {
  try {
    console.log('Confirming profit sharing for transaction:', transactionId);
    const res = await fetch('/confirm-profit-sharing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ transaction_id: parseInt(transactionId), nft_id_to_replace: parseInt(nftIdToReplace) })
    });
    if (!res.ok) throw new Error(`Confirm failed: ${res.status}`);
    const result = await res.text();
    console.log('Profit sharing confirmed:', result);
    document.getElementById('action-result').innerHTML = `<p>${result}</p>`;
    loadRecommendations();
  } catch (error) {
    console.error('Error confirming profit sharing:', error.message);
    document.getElementById('action-result').innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

async function profitSharing() {
  try {
    const nftIdToReplace = prompt('Enter NFT ID to replace in recommendations:');
    const buybackNftId = prompt('Enter Buyback NFT ID (previously sold):');
    if (!nftIdToReplace || !buybackNftId) return alert('Please enter both NFT IDs');
    console.log('Initiating profit sharing for NFT:', buybackNftId, 'to replace:', nftIdToReplace);
    const res = await fetch('/profit-sharing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ nft_id_to_replace: parseInt(nftIdToReplace), buyback_nft_id: parseInt(buybackNftId) })
    });
    if (!res.ok) throw new Error(`Profit sharing failed: ${res.status}`);
    const { message, transactionId, nftIdToReplace: nftId } = await res.json();
    console.log('Profit sharing request:', message);
    document.getElementById('action-result').innerHTML += `<p>${message} <button class="confirm-profit-btn" data-transaction-id="${transactionId}" data-nft-id="${nftId}">Confirm</button></p>`;
    document.querySelectorAll('.confirm-profit-btn').forEach(btn => {
      btn.addEventListener('click', () => confirmProfitSharing(btn.dataset.transactionId, btn.dataset.nftId));
    });
  } catch (error) {
    console.error('Error in profit sharing:', error.message);
    document.getElementById('action-result').innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

async function confirmProfitSharingPrompt() {
  try {
    const transactionId = prompt('Enter Transaction ID to confirm profit sharing:');
    const nftIdToReplace = prompt('Enter NFT ID that was replaced:');
    const buyerId = prompt('Enter Buyer ID (leave blank if same as vendor):');
    const proofUrl = prompt('Enter Proof URL (leave blank if none):');
    if (!transactionId || !nftIdToReplace) return alert('Please enter both Transaction ID and NFT ID');
    await confirmProfitSharing(transactionId, nftIdToReplace, buyerId || null, proofUrl || null);
  } catch (error) {
    console.error('Error in confirming profit sharing:', error.message);
    document.getElementById('action-result').innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

async function confirmProfitSharing(transactionId, nftIdToReplace, buyerId, proofUrl) {
  try {
    console.log('Admin confirming profit sharing for transaction:', transactionId);
    const res = await fetch('/confirm-profit-sharing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ transaction_id: parseInt(transactionId), nft_id_to_replace: parseInt(nftIdToReplace), buyer_id: buyerId, proof_url: proofUrl })
    });
    if (!res.ok) {
      if (res.status === 403) {
        throw new Error('Only admins can confirm transactions. Please contact an admin.');
      }
      throw new Error(`Confirm failed: ${res.status}`);
    }
    const result = await res.text();
    console.log('Profit sharing confirmed:', result);
    document.getElementById('action-result').innerHTML = `<p>${result}</p>`;
    loadRecommendations();
  } catch (error) {
    console.error('Error confirming profit sharing:', error.message);
    document.getElementById('action-result').innerHTML = `<p>Error: ${error.message}</p>`;
  }
}

document.getElementById('login-btn')?.addEventListener('click', () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  login(email, password);
});

document.getElementById('register-btn')?.addEventListener('click', () => {
  const email = document.getElementById('reg-email').value;
  const password = document.getElementById('reg-password').value;
  register(email, password);
});

document.getElementById('show-register-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('login-form').style.display = 'none';
  document.getElementById('register-form').style.display = 'block';
});

document.getElementById('show-login-link')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('register-form').style.display = 'none';
  document.getElementById('login-form').style.display = 'block';
});

document.getElementById('logout-btn')?.addEventListener('click', logout);
document.getElementById('reward-btn')?.addEventListener('click', placeRecommendation);
document.getElementById('profit-sharing-btn')?.addEventListener('click', profitSharing);

document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded');
  token = localStorage.getItem('authToken');
  if (token) {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('pool').style.display = 'block';
    loadRecommendations();
    checkVendorStatus();
  } else {
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('pool').style.display = 'none';
    hideVendorActions();
  }
  document.getElementById('confirm-sale-btn')?.addEventListener('click', confirmSale);
});