import OpenAlgo from 'openalgo';

// Replace 'YOUR_API_KEY' with your actual API key
// Specify the host URL with your hosted domain or ngrok domain.
// If running locally in Windows then use the default host value.
const openalgo = new OpenAlgo('af36ff8c7279c60b63a1d481c22d649a61befca94eed3241f8d935bbefcc980c', 'http://89.116.122.56:5000');
const response = await openalgo.funds();
console.log(response);

