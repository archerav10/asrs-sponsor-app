// Inspirational quotes for the Weekly Focus Compose screen's "Suggest a
// quote". Hand-picked rather than AI-generated: these go out under the
// Executive Director's name, so each one is either well documented to
// its author or labeled as a proverb / author unknown. Widely shared
// quotes with doubtful attributions (many credited to Gandhi, Twain,
// Einstein, Mother Teresa and Maya Angelou, for example) are left out on
// purpose. Add more here; the theme must be one of THEMES.
const THEMES = ['Kindness', 'Service', 'Teamwork', 'Perseverance', 'Hope', 'Self-care', 'Safety'];

const QUOTES = [
  // Kindness
  { text: 'No act of kindness, no matter how small, is ever wasted.', author: 'Aesop', theme: 'Kindness' },
  { text: 'Wherever there is a human being, there is an opportunity for a kindness.', author: 'Seneca', theme: 'Kindness' },
  { text: 'Be kind, for everyone you meet is fighting a hard battle.', author: 'Ian Maclaren', theme: 'Kindness' },
  { text: 'Too often we underestimate the power of a touch, a smile, a kind word, a listening ear, an honest compliment, or the smallest act of caring, all of which have the potential to turn a life around.', author: 'Leo Buscaglia', theme: 'Kindness' },
  { text: 'Be kind whenever possible. It is always possible.', author: 'Dalai Lama', theme: 'Kindness' },
  { text: 'Love and compassion are necessities, not luxuries. Without them, humanity cannot survive.', author: 'Dalai Lama', theme: 'Kindness' },
  { text: 'Kindness is the sunshine in which virtue grows.', author: 'Robert G. Ingersoll', theme: 'Kindness' },

  // Service
  { text: 'We rise by lifting others.', author: 'Robert G. Ingersoll', theme: 'Service' },
  { text: 'Life\'s most persistent and urgent question is, "What are you doing for others?"', author: 'Martin Luther King Jr.', theme: 'Service' },
  { text: 'No one is useless in this world who lightens the burdens of another.', author: 'Charles Dickens', theme: 'Service' },
  { text: 'What we have done for ourselves alone dies with us; what we have done for others and the world remains and is immortal.', author: 'Albert Pike', theme: 'Service' },
  { text: 'Those who are happiest are those who do the most for others.', author: 'Booker T. Washington', theme: 'Service' },
  { text: 'The only ones among you who will be really happy are those who will have sought and found how to serve.', author: 'Albert Schweitzer', theme: 'Service' },
  { text: 'The meaning of life is to find your gift. The purpose of life is to give it away.', author: 'David Viscott', theme: 'Service' },
  { text: 'The greatest good you can do for another is not just to share your riches but to reveal to him his own.', author: 'Benjamin Disraeli', theme: 'Service' },
  { text: 'Do your little bit of good where you are; it\'s those little bits of good put together that overwhelm the world.', author: 'Desmond Tutu', theme: 'Service' },

  // Teamwork
  { text: 'Alone we can do so little; together we can do so much.', author: 'Helen Keller', theme: 'Teamwork' },
  { text: 'Great things are done by a series of small things brought together.', author: 'Vincent van Gogh', theme: 'Teamwork' },
  { text: 'Unity is strength. When there is teamwork and collaboration, wonderful things can be achieved.', author: 'Mattie Stepanek', theme: 'Teamwork' },
  { text: 'Talent wins games, but teamwork and intelligence win championships.', author: 'Michael Jordan', theme: 'Teamwork' },
  { text: 'Many hands make light work.', author: 'Proverb', theme: 'Teamwork' },

  // Perseverance
  { text: 'If you can\'t fly, then run. If you can\'t run, then walk. If you can\'t walk, then crawl. But whatever you do, you have to keep moving forward.', author: 'Martin Luther King Jr.', theme: 'Perseverance' },
  { text: 'The best way out is always through.', author: 'Robert Frost', theme: 'Perseverance' },
  { text: 'Courage doesn\'t always roar. Sometimes courage is the quiet voice at the end of the day saying, "I will try again tomorrow."', author: 'Mary Anne Radmacher', theme: 'Perseverance' },
  { text: 'Success is to be measured not so much by the position that one has reached in life as by the obstacles which he has overcome.', author: 'Booker T. Washington', theme: 'Perseverance' },
  { text: 'I am not afraid of storms, for I am learning how to sail my ship.', author: 'Louisa May Alcott', theme: 'Perseverance' },
  { text: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin', theme: 'Perseverance' },
  { text: 'Patience and diligence, like faith, remove mountains.', author: 'William Penn', theme: 'Perseverance' },
  { text: 'Start where you are. Use what you have. Do what you can.', author: 'Arthur Ashe', theme: 'Perseverance' },
  { text: 'A journey of a thousand miles begins with a single step.', author: 'Lao Tzu', theme: 'Perseverance' },
  { text: 'Fall seven times, stand up eight.', author: 'Japanese proverb', theme: 'Perseverance' },
  { text: 'Little by little, one travels far.', author: 'Proverb', theme: 'Perseverance' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin', theme: 'Perseverance' },
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', author: 'Will Durant', theme: 'Perseverance' },
  { text: 'The time is always right to do what is right.', author: 'Martin Luther King Jr.', theme: 'Perseverance' },

  // Hope
  { text: '"Hope" is the thing with feathers that perches in the soul, and sings the tune without the words, and never stops at all.', author: 'Emily Dickinson', theme: 'Hope' },
  { text: 'Optimism is the faith that leads to achievement. Nothing can be done without hope and confidence.', author: 'Helen Keller', theme: 'Hope' },
  { text: 'Although the world is full of suffering, it is also full of the overcoming of it.', author: 'Helen Keller', theme: 'Hope' },
  { text: 'Hope is being able to see that there is light despite all of the darkness.', author: 'Desmond Tutu', theme: 'Hope' },
  { text: 'Every day may not be good, but there is something good in every day.', author: 'Author unknown', theme: 'Hope' },

  // Self-care
  { text: 'Almost everything will work again if you unplug it for a few minutes, including you.', author: 'Anne Lamott', theme: 'Self-care' },
  { text: 'You can\'t pour from an empty cup. Take care of yourself first.', author: 'Author unknown', theme: 'Self-care' },
  { text: 'Rest is not idleness.', author: 'John Lubbock', theme: 'Self-care' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs', theme: 'Self-care' },

  // Safety
  { text: 'An ounce of prevention is worth a pound of cure.', author: 'Benjamin Franklin', theme: 'Safety' },
  { text: 'Safety doesn\'t happen by accident.', author: 'Author unknown', theme: 'Safety' },
  { text: 'Better safe than sorry.', author: 'Proverb', theme: 'Safety' },
  { text: 'Prepare and prevent, don\'t repair and repent.', author: 'Author unknown', theme: 'Safety' }
];

module.exports = { THEMES, QUOTES };
