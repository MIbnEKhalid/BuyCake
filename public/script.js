
document.addEventListener('DOMContentLoaded', () => {
  // Handle add to cart forms
  document.querySelectorAll('.add-to-cart-form').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const cakeId = form.dataset.cakeId;
      const button = form.querySelector('button');
      const originalText = button.textContent;

      // Show loading state
      button.disabled = true;
      button.textContent = 'Adding...';

      try {
        const response = await fetch('/cart/add', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `cakeId=${cakeId}`
        });

        const data = await response.json();

        if (data.success) {
          // Update cart count
          const cartCount = document.querySelector('.cart-count');
          cartCount.textContent = data.count;

          // Add animation to cart count
          cartCount.classList.add('animate-bounce');
          setTimeout(() => {
            cartCount.classList.remove('animate-bounce');
          }, 1000);

          // Show success feedback
          button.textContent = 'Added!';
          setTimeout(() => {
            button.textContent = originalText;
            button.disabled = false;
          }, 1000);
        }
      } catch (error) {
        console.error('Error:', error);
        button.textContent = 'Error';
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
        }, 1000);
      }
    });
  });
});

// Set minimum delivery date (tomorrow)
document.addEventListener('DOMContentLoaded', () => {
  const deliveryDateInput = document.getElementById('delivery_date');
  if (deliveryDateInput) {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    
    deliveryDateInput.min = `${yyyy}-${mm}-${dd}`;
  }
});