# This program calculates the factorial of a given number

def factorial(n):
    """Return the factorial of a non-negative integer n."""
    if n == 0:
        return 1
    else:
        return n * factorial(n - 1)

# Input from the user
number = int(input("Enter a non-negative integer: "))

if number < 0:
    print("Factorial is not defined for negative numbers.")
else:
    print(f"The factorial of {number} is {factorial(number)}.")
