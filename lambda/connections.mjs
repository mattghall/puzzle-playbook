import https from 'https';

// Function to get the current date in Pacific Time zone and format it as YYYY-MM-DD
const getPacificDate = () => {
  const now = new Date();
  const pacificOffset = -7; // Pacific Time offset (adjust for daylight savings if necessary)
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const pacificTime = new Date(utc + (3600000 * pacificOffset));

  const year = pacificTime.getFullYear();
  const month = String(pacificTime.getMonth() + 1).padStart(2, '0'); // Month is zero-indexed
  const day = String(pacificTime.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
};

// Function to fetch JSON data from the provided URL
const fetchJsonData = (url) => {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(JSON.parse(data));
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
};

// Lambda handler
export const handler = async (event) => {
  try {
    // Get today's date in Pacific Time and format it as YYYY-MM-DD
    const date = getPacificDate();

    // Construct the URL using today's date
    const url = `https://www.nytimes.com/svc/connections/v2/${date}.json`;

    // Fetch the JSON data from the URL
    const data = await fetchJsonData(url);

    // Flatten the cards from all categories into one list and map to the desired format
    // Step 1: Extract all content words into a list
const contentWords = data.categories.flatMap(category =>
  category.cards.map(card => card.content)
);

// Step 2: Sort the list alphabetically
const sortedWords = contentWords.sort();

    return {
      statusCode: 200,
      body: JSON.stringify(sortedWords, null, 2),
    };
  } catch (error) {
    console.error('Error fetching or parsing the JSON data:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ message: 'Error fetching or parsing the JSON data', error }),
    };
  }
};
